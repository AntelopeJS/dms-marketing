import type { IncomingHttpHeaders } from "node:http";
import { Logging } from "@antelopejs/interface-core/logging";
import type { Website } from "@/db/tables/websites.table";
import { MS_PER_MINUTE } from "@/types/constants";
import { BoundedCache } from "./bounded-cache";
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

export function warnRejectedSource(websiteId: string, hostname: string): void {
  if (rejectionLogGate.get(websiteId)) {
    return;
  }
  rejectionLogGate.set(websiteId, true);
  Logging.Warn(
    `[dms-marketing] collect: refusing beacons for website '${websiteId}' sent from '${hostname}' — add it to the site's domain/extraDomains if it is yours.`,
  );
}
