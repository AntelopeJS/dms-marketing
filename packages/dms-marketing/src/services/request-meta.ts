import type { RequestContext } from "@antelopejs/interface-api";
import { getConfig } from "@/config";

/** Every `X-Forwarded-For` entry, leftmost first, across repeated headers. */
function forwardedChain(value: string | string[] | undefined): string[] {
  return [value ?? []]
    .flat()
    .flatMap((line) => line.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Request identity inputs shared by every surface that derives the anonymous
 * visitor hash (collect, snapshots, the assignments script) and the per-source
 * rate limits. `X-Forwarded-For` is only read behind the `trustedProxyHops`
 * proxies the deployment declares, and only at the entry the outermost of
 * them appended: anything left of it is whatever the client chose to send —
 * a fresh visitor per request, a rate limit dodged, or someone else's IP.
 * A request carrying fewer entries than declared hops did not come through
 * the proxies, and is identified by its socket.
 */
export function clientIp(context: RequestContext): string {
  const socketAddress = context.rawRequest.socket.remoteAddress ?? "";
  const hops = getConfig().trustedProxyHops;
  if (!Number.isInteger(hops) || hops <= 0) {
    return socketAddress;
  }
  const chain = forwardedChain(context.rawRequest.headers["x-forwarded-for"]);
  return chain.length >= hops ? chain[chain.length - hops] : socketAddress;
}

export function userAgentOf(context: RequestContext): string {
  const header = context.rawRequest.headers["user-agent"];
  return typeof header === "string" ? header : "";
}
