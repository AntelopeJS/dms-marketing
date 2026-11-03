import {
  dayRowId,
  type WebsiteStatisticsModel,
} from "@/db/models/website_statistics.model";
import type {
  AppliedImport,
  WebsiteStatistics,
} from "@/db/tables/website_statistics.table";
import {
  byDimension,
  type MarketingStatsDelta,
  type TopDimension,
  type TopEntries,
} from "@/types";
import { MAX_ENTRIES_PER_TOP_MAP } from "@/types/constants";
import { KeyedQueue } from "./keyed-queue";

export function getUtcMidnight(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/**
 * Keys land as field names of the stored maps, and their values are
 * tracker-controlled (UTM parameters ride in on any URL): names the storage
 * layer reserves ("$"-prefixed) and the name JavaScript's prototype setter
 * swallows are dropped like blank values.
 */
function isStorableTopKey(key: string): boolean {
  return !key.startsWith("$") && key !== "__proto__";
}

/**
 * Evicts the smallest entry once the cap is hit, bounding the row size
 * regardless of URL cardinality.
 */
function incrementTopEntry(record: TopEntries, key: string): void {
  if (!isStorableTopKey(key)) {
    return;
  }
  if (
    record[key] === undefined &&
    Object.keys(record).length >= MAX_ENTRIES_PER_TOP_MAP
  ) {
    const smallest = Object.entries(record).reduce((min, entry) =>
      entry[1] < min[1] ? entry : min,
    );
    delete record[smallest[0]];
  }
  record[key] = (record[key] ?? 0) + 1;
}

/**
 * A drop aimed at a key this row never counted (the increment landed on
 * another day's row, or was evicted) is skipped: a negative entry would sort
 * as noise and never recover.
 */
function decrementTopEntry(record: TopEntries, key: string): void {
  const current = record[key];
  if (current === undefined) {
    return;
  }
  if (current <= 1) {
    delete record[key];
    return;
  }
  record[key] = current - 1;
}

function mergedTops(
  current: Record<TopDimension, TopEntries> | undefined,
  delta: MarketingStatsDelta,
): Record<TopDimension, TopEntries> {
  return byDimension<TopEntries>((dimension) => {
    const merged = { ...current?.[dimension] };
    for (const value of delta.tops[dimension]) {
      incrementTopEntry(merged, value);
    }
    for (const value of delta.drops[dimension] ?? []) {
      decrementTopEntry(merged, value);
    }
    return merged;
  });
}

function foldedTops(
  current: Record<TopDimension, TopEntries> | undefined,
  deltas: MarketingStatsDelta[],
): Record<TopDimension, TopEntries> {
  let tops = current ?? byDimension<TopEntries>(() => ({}));
  for (const delta of deltas) {
    tops = mergedTops(tops, delta);
  }
  return tops;
}

function summedCounters(deltas: MarketingStatsDelta[]) {
  const sum = (pick: (delta: MarketingStatsDelta) => number) =>
    deltas.reduce((total, delta) => total + pick(delta), 0);
  return {
    pageviews: sum((delta) => delta.pageviews),
    sessions: sum((delta) => delta.sessions),
    newVisitors: sum((delta) => delta.newVisitors),
    customEvents: sum((delta) => delta.customEvents),
    bouncedSessions: sum((delta) => delta.bouncedSessions),
    sessionDurationMs: sum((delta) => delta.sessionDurationMs),
  };
}

/**
 * Adds the deltas to the day row of the website, inserting the row on the first
 * write. Losing the insert race (another instance created the row first) falls
 * through to the increment, but the database interface exposes no typed
 * conflict error, and matching driver messages would tie the module to one
 * backend. So the state is probed, not the error: a row that exists after a
 * failed insert is the lost race, whatever the driver called it; no row means
 * the insert failed for real.
 *
 * `applied` lands in the same single-row write as the counters: a day is either
 * counted and named in the ledger, or neither.
 */
async function writeDailyStats(
  model: WebsiteStatisticsModel,
  websiteId: string,
  day: number,
  deltas: MarketingStatsDelta[],
  applied?: AppliedImport,
): Promise<void> {
  const id = dayRowId(websiteId, day);
  const counters = summedCounters(deltas);
  let existing = await model.get(id);
  if (!existing) {
    const row: WebsiteStatistics = {
      _id: id,
      websiteId,
      day,
      ...counters,
      tops: foldedTops(undefined, deltas),
      ...(applied && { appliedImports: [applied] }),
    };
    try {
      await model.insert(row);
      return;
    } catch (error) {
      existing = await model.get(id);
      if (!existing) {
        throw error;
      }
    }
  }
  await model.addDelta(
    id,
    counters,
    foldedTops(existing.tops, deltas),
    applied && [...(existing.appliedImports ?? []), applied],
  );
}

/**
 * One write chain per website: the scalar counters are native increments and
 * survive any interleaving, but the top maps are a read-merge-write — two
 * batches for one site racing through it would drop one batch's map entries.
 * The chain closes that window per instance; across instances the maps stay
 * last-write-wins, an approximation the maps already accept by evicting on a
 * cap.
 */
const pendingBySite = new KeyedQueue();

export function addDailyMarketingStats(
  model: WebsiteStatisticsModel,
  websiteId: string,
  day: number,
  delta: MarketingStatsDelta,
): Promise<void> {
  return pendingBySite.run(websiteId, () =>
    writeDailyStats(model, websiteId, day, [delta]),
  );
}

/**
 * Counts an imported day: all its held deltas and its ledger entry, in one
 * write to its day row.
 */
export function commitImportedDay(
  model: WebsiteStatisticsModel,
  websiteId: string,
  day: number,
  deltas: MarketingStatsDelta[],
  applied: AppliedImport,
): Promise<void> {
  return pendingBySite.run(websiteId, () =>
    writeDailyStats(model, websiteId, day, deltas, applied),
  );
}
