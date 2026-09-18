import type { RequestContext } from "@antelopejs/interface-api";

/**
 * Request identity inputs shared by every surface that derives the anonymous
 * visitor hash (collect, the assignments script). Trusting X-Forwarded-For is
 * deliberate: the module deploys behind its own proxy. Never read it for an
 * endpoint that would let the caller PICK an identity — these values must
 * always describe the connection actually made.
 */
export function clientIp(context: RequestContext): string {
  const fwd = context.rawRequest.headers["x-forwarded-for"];
  if (typeof fwd === "string") {
    return fwd.split(",")[0].trim();
  }
  if (Array.isArray(fwd) && fwd.length > 0) {
    return fwd[0];
  }
  return context.rawRequest.socket.remoteAddress ?? "";
}

export function userAgentOf(context: RequestContext): string {
  const header = context.rawRequest.headers["user-agent"];
  return typeof header === "string" ? header : "";
}
