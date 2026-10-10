import { GetModel } from "@antelopejs/interface-database-decorators";
import { WebsiteStatisticsModel } from "@/db";
import type { WebsiteStatistics } from "@/db/tables/website_statistics.table";
import type { Website } from "@/db/tables/websites.table";
import type { MarketingDayCounters, TopDimension, TopEntries } from "@/types";
import { type QueryWindow, windowDays } from "./period";

export type RollupTotals = Omit<MarketingDayCounters, "day">;

/** The rollup rows of one window, the comparison window's beside it. */
export interface RollupRead {
  window: QueryWindow;
  rows: WebsiteStatistics[];
  compare: QueryWindow | null;
  compareRows: WebsiteStatistics[];
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
  const [rows, compareRows] = await Promise.all([
    readRollups(website, window),
    compare ? readRollups(website, compare) : Promise.resolve([]),
  ]);
  return { window, rows, compare, compareRows };
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
