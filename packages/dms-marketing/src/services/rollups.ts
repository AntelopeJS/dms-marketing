import { GetModel } from "@antelopejs/interface-database-decorators";
import { WebsiteStatisticsModel } from "@/db";
import type { WebsiteStatistics } from "@/db/tables/website_statistics.table";
import type { Website } from "@/db/tables/websites.table";
import {
  byDimension,
  type MarketingDayCounters,
  type TopDimension,
  type TopEntries,
} from "@/types";
import { elapsedShare, type QueryWindow, windowDays } from "./period";

export type RollupTotals = Omit<MarketingDayCounters, "day">;

/**
 * The rollup rows of one window, the comparison window's beside it. A
 * comparison window with no row at all (before the site existed, past the
 * retention) is no comparison: `compare` is null rather than a window of
 * zeros every change would be measured against.
 */
export interface RollupRead {
  window: QueryWindow;
  rows: WebsiteStatistics[];
  compare: QueryWindow | null;
  /**
   * The comparison rows every change is computed from: while the read
   * window's last day is still being counted, the matching day of the
   * comparison counts for the same share of its day (see {@link elapsedShare}),
   * so a day half gone is not set against a whole one.
   */
  compareRows: WebsiteStatistics[];
  /** The comparison rows as stored, the whole days a chart draws. */
  compareDays: WebsiteStatistics[];
}

export const EMPTY_TOTALS: RollupTotals = {
  pageviews: 0,
  sessions: 0,
  newVisitors: 0,
  customEvents: 0,
  bouncedSessions: 0,
  sessionDurationMs: 0,
};

export async function readRollups(
  website: Website,
  window: QueryWindow,
): Promise<WebsiteStatistics[]> {
  return GetModel(WebsiteStatisticsModel, website.tenantId).getDaysBetween(
    website._id,
    window.firstDay,
    window.lastDay,
  );
}

export async function readRollupsWithComparison(
  website: Website,
  window: QueryWindow,
  compare: QueryWindow | null,
): Promise<RollupRead> {
  const [rows, stored] = await Promise.all([
    readRollups(website, window),
    compare ? readRollups(website, compare) : Promise.resolve([]),
  ]);
  if (!compare || stored.length === 0) {
    return { window, rows, compare: null, compareRows: [], compareDays: [] };
  }
  const share = elapsedShare(window);
  const compareRows =
    share < 1
      ? stored.map((row) =>
          row.day === compare.lastDay ? scaleRow(row, share) : row,
        )
      : stored;
  return { window, rows, compare, compareRows, compareDays: stored };
}

function scaleEntries(entries: TopEntries, share: number): TopEntries {
  return Object.fromEntries(
    Object.entries(entries).map(([key, count]) => [key, count * share]),
  );
}

/** A day's counts cut to `share` of it, as if read that far into the day. */
function scaleRow(row: WebsiteStatistics, share: number): WebsiteStatistics {
  const stored = row.tops;
  const tops = stored
    ? byDimension((dimension) => {
        const entries = stored[dimension];
        return entries ? scaleEntries(entries, share) : entries;
      })
    : stored;
  return Object.assign({}, row, {
    pageviews: row.pageviews * share,
    sessions: row.sessions * share,
    newVisitors: row.newVisitors * share,
    customEvents: row.customEvents * share,
    bouncedSessions: (row.bouncedSessions ?? 0) * share,
    sessionDurationMs: (row.sessionDurationMs ?? 0) * share,
    tops,
  });
}

export function sumRollups(rows: readonly WebsiteStatistics[]): RollupTotals {
  return rows.reduce<RollupTotals>(
    (totals, row) => ({
      pageviews: totals.pageviews + row.pageviews,
      sessions: totals.sessions + row.sessions,
      newVisitors: totals.newVisitors + row.newVisitors,
      customEvents: totals.customEvents + row.customEvents,
      bouncedSessions: totals.bouncedSessions + (row.bouncedSessions ?? 0),
      sessionDurationMs:
        totals.sessionDurationMs + (row.sessionDurationMs ?? 0),
    }),
    { ...EMPTY_TOTALS },
  );
}

/** One value per day of the window, days without a row at zero. */
export function dailyValues(
  rows: readonly WebsiteStatistics[],
  window: QueryWindow,
  pick: (row: WebsiteStatistics) => number,
): number[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return windowDays(window).map((day) => {
    const row = byDay.get(day);
    return row ? pick(row) : 0;
  });
}

/** Sum one dimension's per-day maps over the rows. */
export function mergeDimension(
  rows: ReadonlyArray<Pick<WebsiteStatistics, "tops">>,
  dimension: TopDimension,
): TopEntries {
  const merged: TopEntries = {};
  for (const row of rows) {
    for (const [key, count] of Object.entries(row.tops?.[dimension] ?? {})) {
      merged[key] = (merged[key] ?? 0) + count;
    }
  }
  return merged;
}

export interface RankedEntry {
  key: string;
  value: number;
}

export function rankEntries(
  entries: TopEntries,
  limit?: number,
): RankedEntry[] {
  const ranked = Object.entries(entries)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => ({ key, value }))
    .sort((a, b) => b.value - a.value);
  return limit === undefined ? ranked : ranked.slice(0, limit);
}

/**
 * Relative change in percent, the unit the DMS cards read `delta` in; null
 * when there is nothing to compare with, so no badge claims "+∞".
 */
export function percentChange(
  current: number,
  previous: number | undefined,
): number | null {
  if (previous === undefined || previous === 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

export function shareOf(value: number, total: number): number {
  return total > 0 ? (value / total) * 100 : 0;
}
