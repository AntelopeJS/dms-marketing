import type { IncomingHttpHeaders } from "node:http";
import { Logging } from "@antelopejs/interface-core/logging";
import type { Website } from "@/db/tables/websites.table";
import { MS_PER_MINUTE } from "@/types/constants";
import { BoundedCache, setBounded } from "./bounded-cache";
import { toBareHostname } from "./url";

function firstHeaderValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Unparsable values (the "null" of sandboxed frames included) come back
 * as-is so they match no domain; undefined only when neither header came. */
export function requestSourceHostname(
  headers: IncomingHttpHeaders,
): string | undefined {
  const source =
    firstHeaderValue(headers.origin) ?? firstHeaderValue(headers.referer);
  if (!source) {
    return undefined;
  }
  try {
    return new URL(source).hostname;
  } catch {
    return source.toLowerCase();
  }
}

export function websiteAcceptsHostname(
  website: Website,
  hostname: string,
): boolean {
  const bare = toBareHostname(hostname);
  if (!bare) {
    return false;
  }
  return [website.domain, ...(website.extraDomains ?? [])].some((candidate) => {
    const domain = toBareHostname(candidate);
    return (
      domain !== undefined && (bare === domain || bare.endsWith(`.${domain}`))
    );
  });
}

const rejectionLogGate = new BoundedCache<true>(MS_PER_MINUTE);

/** Refusals of one host for one website, for the install check. */
export interface RejectedSource {
  hostname: string;
  count: number;
  lastAt: number;
}

const MAX_REJECTED_HOSTS_PER_WEBSITE = 5;
const MAX_TRACKED_WEBSITES = 1_000;
const REJECTIONS_TTL_MS = 60 * MS_PER_MINUTE;

/**
 * Per-instance memory of the beacons refused per website and host. Enough for
 * the install guide, which polls while someone installs the tag: what it needs
 * is "a staging host was refused a minute ago", not a durable audit trail.
 */
const rejectedSources = new Map<string, Map<string, RejectedSource>>();

function recordRejectedSource(websiteId: string, hostname: string): void {
  const hosts =
    rejectedSources.get(websiteId) ?? new Map<string, RejectedSource>();
  const previous = hosts.get(hostname);
  hosts.delete(hostname);
  setBounded(
    hosts,
    hostname,
    { hostname, count: (previous?.count ?? 0) + 1, lastAt: Date.now() },
    MAX_REJECTED_HOSTS_PER_WEBSITE,
  );
  rejectedSources.delete(websiteId);
  setBounded(rejectedSources, websiteId, hosts, MAX_TRACKED_WEBSITES);
}

/** Recent refusals of a website, most recent first. */
export function listRejectedSources(websiteId: string): RejectedSource[] {
  const cutoff = Date.now() - REJECTIONS_TTL_MS;
  return [...(rejectedSources.get(websiteId)?.values() ?? [])]
    .filter((source) => source.lastAt >= cutoff)
    .sort((a, b) => b.lastAt - a.lastAt);
}

/** A host the owner just allowed stops being reported as refused. */
export function forgetRejectedSources(websiteId: string): void {
  rejectedSources.delete(websiteId);
}

export function warnRejectedSource(websiteId: string, hostname: string): void {
  recordRejectedSource(websiteId, hostname);
  if (rejectionLogGate.get(websiteId)) {
    return;
  }
  rejectionLogGate.set(websiteId, true);
  Logging.Warn(
    `[dms-marketing] collect: refusing beacons for website '${websiteId}' sent from '${hostname}' — add it to the site's domain/extraDomains if it is yours.`,
  );
}
