import type { RequestContext } from "@antelopejs/interface-api";
import { isString } from "@/utils/guards";

/**
 * The user agent a request names, one of the inputs of the anonymous visitor
 * hash (collect, snapshots, the assignments script) and of the automation
 * check. The other, the client address, is the DMS's `getClientIp`: it
 * resolves `X-Forwarded-For` behind the reverse proxies the DMS trusts
 * (`auth.trustedProxies`).
 */
export function userAgentOf(context: RequestContext): string {
  const header = context.rawRequest.headers["user-agent"];
  return isString(header) ? header : "";
}
