import { createHash } from "node:crypto";
import { VISITOR_ID_HEX_LENGTH } from "@/types/constants";

/** "YYYY-MM" — salt rotation period. */
const PERIOD_KEY_LENGTH = 7;

function periodKey(now: Date): string {
  return now.toISOString().slice(0, PERIOD_KEY_LENGTH);
}

/**
 * Anonymous visitor identity: sha256(salt, website, ip, user agent), the salt
 * derived from a server secret and the current month. No cookie, IP and user
 * agent never persisted — the shape audience-measurement consent exemptions
 * ask for. Monthly salt rotation keeps weekly retention cohorts meaningful
 * while bounding how long the same person stays linkable.
 */
export function computeVisitorId(
  secret: string,
  websiteId: string,
  ip: string,
  userAgent: string,
  now: Date = new Date(),
): string {
  const salt = createHash("sha256")
    .update(`${secret}:${periodKey(now)}`)
    .digest("hex");
  return createHash("sha256")
    .update(`${salt}:${websiteId}:${ip}:${userAgent}`)
    .digest("hex")
    .slice(0, VISITOR_ID_HEX_LENGTH);
}
