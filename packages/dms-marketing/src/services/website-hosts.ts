import type { Website } from "@/db/tables/websites.table";
import { MAX_DOMAIN_LENGTH, MS_PER_MINUTE } from "@/types/constants";
import { BoundedCache } from "./bounded-cache";
import { toBareHostname } from "./url";

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//;
const TRAILING_DOT = /\.$/;
/** RFC 1123 labels: letters, digits and inner hyphens, 63 characters at most.
 * One label alone is a host too (localhost, an intranet name); IPv4 matches. */
const HOSTNAME = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/;
const IPV6_HOST = /^\[[0-9a-f:.]+\]$/;

/**
 * What an owner types for a domain, reduced to the hostname the guard
 * compares: "https://Shop.Example.com:8443/path" → "shop.example.com". A
 * value no URL parser accepts comes back trimmed and lowercased, for
 * `isValidHostname` to refuse. `www.` is kept: it is what "Open the site"
 * links to, and the guard ignores it either way.
 */
export function normalizeHostname(value: string): string {
  const text = value.trim().toLowerCase();
  try {
    const url = new URL(SCHEME.test(text) ? text : `http://${text}`);
    return url.hostname.replace(TRAILING_DOT, "");
  } catch {
    return text;
  }
}

/** "null" is what sandboxed frames send as their Origin, never a site. */
export function isValidHostname(hostname: string): boolean {
  return (
    hostname !== "null" &&
    hostname.length <= MAX_DOMAIN_LENGTH &&
    (HOSTNAME.test(hostname) || IPV6_HOST.test(hostname))
  );
}

/** The bare hosts a website declares: its domain and its extra domains. */
function declaredHosts(website: Website): string[] {
  return [website.domain, ...(website.extraDomains ?? [])]
    .map(toBareHostname)
    .filter((host) => host !== undefined);
}

/** Where a host the owner declares is already declared by another site. */
export interface HostConflict {
  field: "domain" | "extraDomains";
  hostname: string;
  website: Website;
}

/**
 * The first host of `candidate` another website of the tenant already
 * declares — as its domain or one of its extra domains. Two sites on one
 * host would split its traffic by whichever id the tag carries, and show as
 * two identical entries in the site switcher. A subdomain of another site's
 * domain is not a conflict: a shop and its docs are routinely two sites.
 */
export function findHostConflict(
  candidate: Pick<Website, "_id" | "domain" | "extraDomains">,
  websites: Website[],
): HostConflict | undefined {
  const taken = new Map<string, Website>();
  for (const website of websites) {
    if (website._id === candidate._id) {
      continue;
    }
    for (const host of declaredHosts(website)) {
      taken.set(host, website);
    }
  }
  const fields = [
    ["domain", [candidate.domain]],
    ["extraDomains", candidate.extraDomains ?? []],
  ] as const;
  for (const [field, hosts] of fields) {
    for (const hostname of hosts.map(toBareHostname)) {
      const website = hostname ? taken.get(hostname) : undefined;
      if (hostname && website) {
        return { field, hostname, website };
      }
    }
  }
  return undefined;
}

/** The last host a website's beacons were accepted from. */
export interface AcceptedSource {
  hostname: string;
  at: number;
}

const ACCEPTED_SOURCES_TTL_MS = 60 * MS_PER_MINUTE;

/**
 * Per-instance memory of where each website's beacons last came from, the
 * counterpart of the refused hosts: the install check names the host of the
 * pageview it shows (raw events keep the path only). Bounded: the website id
 * comes from an unauthenticated request.
 */
const acceptedSources = new BoundedCache<AcceptedSource>(
  ACCEPTED_SOURCES_TTL_MS,
);

/** Called by collect once a beacon got past the origin guard. */
export function recordAcceptedSource(websiteId: string, hostname: string) {
  acceptedSources.set(websiteId, { hostname, at: Date.now() });
}

export function lastAcceptedSource(
  websiteId: string,
): AcceptedSource | undefined {
  return acceptedSources.get(websiteId)?.value;
}
