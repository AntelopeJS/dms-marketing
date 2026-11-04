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
import { forgetCaptureTimes } from "./snapshots";

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
 * Top maps live shorter than their row: past the oldest day a read or its
 * comparison reaches (`TOP_MAPS_RETENTION_DAYS`, a year plus
 * `MAX_QUERY_PERIOD_DAYS`) the maps are emptied and the scalar counters keep the full
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
 * back is page content kept for nothing. A pruned page is captured again at
 * its next sampled visit: the negotiation forgets what it remembered. */
export async function pruneSnapshots(
  model: PageSnapshotsModel,
): Promise<number> {
  const config = getConfig();
  const cutoff = new Date(
    Date.now() - Math.min(config.snapshotRetention, config.rawEventsRetention),
  );
  const deleted = await model.deleteOlderThan(cutoff);
  if (deleted > 0) {
    forgetCaptureTimes();
  }
  return deleted;
}

const EPOCH_LOWER_BOUND = new Date(0);

async function countAcrossTenants(
  count: (tenantId: string) => Promise<number>,
): Promise<number> {
  const tenantIds = await GetModel(WebsitesModel).listTenantIds();
  let total = 0;
  for (const tenantId of tenantIds) {
    total += await count(tenantId);
  }
  return total;
}

/**
 * What a retention cut at `cutoff` would delete, every tenant together: the
 * figure the Settings page asks a lowered retention to be confirmed with.
 */
export function countRawEventsBefore(cutoff: Date): Promise<number> {
  return countAcrossTenants((id) =>
    GetModel(MarketingEventsModel, id)
      .table.between("timestamp", EPOCH_LOWER_BOUND, cutoff)
      .count()
      .run(),
  );
}

export function countSnapshotsBefore(cutoff: Date): Promise<number> {
  return countAcrossTenants((id) =>
    GetModel(PageSnapshotsModel, id)
      .table.between("capturedAt", EPOCH_LOWER_BOUND, cutoff)
      .count()
      .run(),
  );
}

/** Sessions, the figure shown, and the daily rollups that go with them. */
export async function countStatisticsBefore(
  cutoff: Date,
): Promise<{ sessions: number; days: number }> {
  const sessions = await countAcrossTenants((id) =>
    GetModel(MarketingSessionsModel, id)
      .table.between("lastSeenAt", EPOCH_LOWER_BOUND, cutoff)
      .count()
      .run(),
  );
  const days = await countAcrossTenants((id) =>
    GetModel(WebsiteStatisticsModel, id)
      .table.between("day", 0, cutoff.getTime())
      .count()
      .run(),
  );
  return { sessions, days };
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
  onError: (failure: Error) => void,
): Promise<void> {
  const tenantIds = await GetModel(WebsitesModel).listTenantIds();
  for (const tenantId of tenantIds) {
    for (const prune of TENANT_PRUNES) {
      await prune(tenantId).catch((reason: unknown) => {
        onError(
          reason instanceof Error
            ? reason
            : new Error(String(reason), { cause: reason }),
        );
      });
    }
  }
}
