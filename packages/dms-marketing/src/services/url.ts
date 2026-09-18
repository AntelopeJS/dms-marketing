import type { UtmFields } from "@/types";
import { MAX_URL_LENGTH } from "@/types/constants";
import { CLICK_ID_PARAMS } from "./acquisition";

/** Base for parsing tracker-relative URLs ("/pricing?x=1"). */
const RELATIVE_URL_BASE = "http://relative.invalid";
const RELATIVE_HOSTNAME = "relative.invalid";

const UTM_FIELD_KEYS: ReadonlyArray<keyof UtmFields> = [
  "source",
  "medium",
  "campaign",
  "term",
  "content",
];

const UTM_PARAM_PREFIX = "utm_";
const WWW_PREFIX = "www.";

export interface ParsedTrackedUrl {
  path: string;
  hostname?: string;
  utm: UtmFields;
  /** Name of the ad click-id parameter carried, never its value: the value
   * identifies one click and the channel mapping only needs the platform. */
  clickIdParam?: string;
}

export function parseTrackedUrl(rawUrl: string): ParsedTrackedUrl {
  const url = toUrl(rawUrl);
  if (!url) {
    return { path: rawUrl.slice(0, MAX_URL_LENGTH), utm: {} };
  }
  const hostname =
    url.hostname === RELATIVE_HOSTNAME ? undefined : url.hostname;
  return {
    path: url.pathname.slice(0, MAX_URL_LENGTH),
    hostname,
    utm: parseUtm(url),
    clickIdParam: findClickIdParam(url),
  };
}

function toUrl(rawUrl: string): URL | null {
  try {
    return new URL(rawUrl, RELATIVE_URL_BASE);
  } catch {
    return null;
  }
}

/** A valueless `?gclid=` proves nothing and is skipped along with absent ones. */
function findClickIdParam(url: URL): string | undefined {
  return CLICK_ID_PARAMS.find((param) => url.searchParams.get(param));
}

function parseUtm(url: URL): UtmFields {
  const utm: UtmFields = {};
  for (const key of UTM_FIELD_KEYS) {
    const value = url.searchParams.get(`${UTM_PARAM_PREFIX}${key}`);
    if (value) {
      utm[key] = value;
    }
  }
  return utm;
}

/**
 * Comparable form of a host: accepts a bare hostname, a "host:port" pair or a
 * full URL, and answers the lowercase apex without the `www.` prefix. Website
 * domains are free text typed by an operator, so they need it as much as the
 * hostnames parsed out of tracked URLs.
 */
export function toBareHostname(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const url = toUrl(value);
  const host =
    url?.hostname && url.hostname !== RELATIVE_HOSTNAME
      ? url.hostname
      : value.split("/")[0].split(":")[0];
  const lower = host.toLowerCase();
  const bare = lower.startsWith(WWW_PREFIX)
    ? lower.slice(WWW_PREFIX.length)
    : lower;
  return bare || undefined;
}

/**
 * Referrer reduced to its domain; full referrer URLs can embed search terms
 * or user paths we have no reason to keep. Self-referrals are dropped — they
 * are navigation, not acquisition — which is why the caller passes every host
 * the site answers on (see collectOwnHostnames).
 */
export function extractReferrerDomain(
  referrer: string | undefined,
  ownHostnames: ReadonlySet<string>,
): string | undefined {
  if (!referrer) {
    return undefined;
  }
  const url = toUrl(referrer);
  if (!url || url.hostname === RELATIVE_HOSTNAME) {
    return undefined;
  }
  const domain = toBareHostname(url.hostname);
  if (!domain || ownHostnames.has(domain)) {
    return undefined;
  }
  return domain;
}
