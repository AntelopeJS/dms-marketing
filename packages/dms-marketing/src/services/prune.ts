import { GetModel } from "@antelopejs/interface-database-decorators";
import { getConfig } from "@/config";
import {
  MarketingEventsModel,
  MarketingSessionsModel,
  PageSnapshotsModel,
  WebsiteStatisticsModel,
  WebsitesModel,
} from "@/db";
import { MS_PER_DAY, TOP_MAPS_RETENTION_DAYS } from "@/types/constants";

export async function pruneRawEvents(
  model: MarketingEventsModel,
): Promise<number> {
  const cutoff = new Date(Date.now() - getConfig().rawEventsRetention);
  return model.deleteOlderThan(cutoff);
}

/**
 * Sessions follow the long statistics retention, not the raw-events one:
 * retention cohorts (first-seen week × returning weeks) read sessions alone,
 * and one row per visit stays cheap.
 */
export async function pruneSessions(
  model: MarketingSessionsModel,
): Promise<number> {
  const cutoff = new Date(Date.now() - getConfig().statisticsRetention);
  return model.deleteOlderThan(cutoff);
}

export async function pruneStatistics(
  model: WebsiteStatisticsModel,
): Promise<number> {
  const cutoff = Date.now() - getConfig().statisticsRetention;
  return model.deleteDaysBefore(cutoff);
}

/**
 * Top maps live shorter than their row: past the readable window
 * (`TOP_MAPS_RETENTION_DAYS` = `MAX_QUERY_PERIOD_DAYS`, no endpoint reads
 * further back) the maps are emptied and the scalar counters keep the full
 * statistics retention. One functional update bounded on the day index; rows
 * already emptied come back unmodified, so the pass stays cheap.
 */
export async function pruneStatisticsTops(
  model: WebsiteStatisticsModel,
): Promise<number> {
  const cutoff = Date.now() - TOP_MAPS_RETENTION_DAYS * MS_PER_DAY;
  return model.emptyTopsBefore(cutoff);
}

/** Never past the raw events: a backdrop outliving every click it could
 * back is page content kept for nothing. */
export async function pruneSnapshots(
  model: PageSnapshotsModel,
): Promise<number> {
  const config = getConfig();
  const cutoff = new Date(
    Date.now() - Math.min(config.snapshotRetention, config.rawEventsRetention),
  );
  return model.deleteOlderThan(cutoff);
}

const TENANT_PRUNES = [
  (id: string) => pruneRawEvents(GetModel(MarketingEventsModel, id)),
  (id: string) => pruneSnapshots(GetModel(PageSnapshotsModel, id)),
  (id: string) => pruneSessions(GetModel(MarketingSessionsModel, id)),
  (id: string) => pruneStatistics(GetModel(WebsiteStatisticsModel, id)),
  (id: string) => pruneStatisticsTops(GetModel(WebsiteStatisticsModel, id)),
];

/**
 * One retention pass over every tenant instance. The tenant set comes from
 * the global websites table — a tenant with no site never collected anything.
 * Failures are per prune AND per tenant: one broken instance must not shield
 * the others from their retention.
 */
export async function pruneAllTenants(
  onError: (err: unknown) => void,
): Promise<void> {
  const tenantIds = await GetModel(WebsitesModel).listTenantIds();
  for (const tenantId of tenantIds) {
    for (const prune of TENANT_PRUNES) {
      await prune(tenantId).catch(onError);
    }
  }
}
