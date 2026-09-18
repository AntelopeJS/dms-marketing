import { GetModel } from "@antelopejs/interface-database-decorators";
import { FunnelsModel, WebsitesModel } from "@/db";
import type { Funnel } from "@/db/tables/funnels.table";
import { BoundedCache } from "@/services/bounded-cache";
import { EXPERIMENT_DEFINITIONS_CACHE_TTL_MS } from "@/types/constants";

/**
 * Running experiments per website id, negatives included: the key is an
 * unauthenticated query parameter on both readers, so an unknown id must cost
 * at most one database read per TTL, not one per request.
 */
const definitionsCache = new BoundedCache<Funnel[]>(
  EXPERIMENT_DEFINITIONS_CACHE_TTL_MS,
);

/** Called on funnel and website mutations, so start/stop propagates at once
 * on the writing instance; other instances hold theirs for the TTL. */
export function invalidateExperimentDefinitions(websiteId: string): void {
  definitionsCache.delete(websiteId);
}

/** The cached value embodies every per-site check: an unknown site and a
 * tracking-disabled one both cache as "nothing to serve". */
export async function servableExperiments(
  websiteId: string,
): Promise<Funnel[]> {
  const hit = definitionsCache.get(websiteId);
  if (hit) {
    return hit.value;
  }
  const website = await GetModel(WebsitesModel).get(websiteId);
  const running = website?.trackingEnabled
    ? await GetModel(FunnelsModel, website.tenantId).listRunning(websiteId)
    : [];
  definitionsCache.set(websiteId, running);
  return running;
}

/**
 * The keys an exposure may be ingested under. Same cached slice the
 * assignment script serves, so a split stops being collected on the very TTL
 * it stops being assigned — the two would otherwise disagree for a window
 * anyone can keep writing into.
 */
export async function runningExperimentKeys(
  websiteId: string,
): Promise<Set<string>> {
  const running = await servableExperiments(websiteId);
  const keys = new Set<string>();
  for (const funnel of running) {
    if (funnel.experiment) {
      keys.add(funnel.experiment.key);
    }
  }
  return keys;
}
