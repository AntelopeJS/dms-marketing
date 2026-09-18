import { GetModel } from "@antelopejs/interface-database-decorators";
import { WebsitesModel } from "@/db";
import type { Website } from "@/db/tables/websites.table";
import { WEBSITE_CACHE_TTL_MS } from "@/types/constants";
import { BoundedCache } from "./bounded-cache";

/** Website lookups sit on every public hot path (collect beacons, snapshot
 * negotiation); a short TTL cache keeps them off the database. Bounded: the
 * id comes from an unauthenticated request, and an unknown one caches too. */
const websiteCache = new BoundedCache<Website | undefined>(
  WEBSITE_CACHE_TTL_MS,
);

export async function resolveWebsite(id: string): Promise<Website | undefined> {
  const hit = websiteCache.get(id);
  if (hit) {
    return hit.value;
  }
  const website = await GetModel(WebsitesModel).get(id);
  websiteCache.set(id, website);
  return website;
}

/**
 * Called on website edits and deletion so this instance sees them at once;
 * other instances hold theirs for up to the TTL.
 */
export function invalidateWebsiteCache(id: string): void {
  websiteCache.delete(id);
}
