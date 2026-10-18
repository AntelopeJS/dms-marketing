import { GetModel } from "@antelopejs/interface-database-decorators";
import { getConfig } from "@/config";
import { MarketingEventsModel } from "@/db";
import type { Website } from "@/db/tables/websites.table";
import type { EventKind } from "@/types";
import { MS_PER_DAY, MS_PER_HOUR } from "@/types/constants";
import type { KpiMetric } from "./dashboard";
import { hiddenDashboardUrlPattern } from "./dashboard-tracking";

/**
 * Hour-by-hour counts of a single day, read from the raw events: the daily
 * rollups cannot draw the shape of one day.
 */

/** What an hour of raw events counts for a metric; new visitors are only known to the rollups. */
const HOURLY_READS: Partial<
  Record<KpiMetric, { kind: EventKind; perSession: boolean }>
> = {
  pageviews: { kind: "pageview", perSession: false },
  sessions: { kind: "pageview", perSession: true },
  "custom-events": { kind: "custom", perSession: false },
};

export const HOURS_PER_DAY = MS_PER_DAY / MS_PER_HOUR;

/**
 * `hours` hourly counts from `since`, counted in the database; null when the
 * metric has no hourly count or the events are past their retention. A
 * session counts in the hour of its first pageview.
 */
export async function hourlyValues(
  website: Website,
  since: number,
  hours: number,
  metric: KpiMetric,
): Promise<number[] | null> {
  const reading = HOURLY_READS[metric];
  if (!reading || since < Date.now() - getConfig().rawEventsRetention) {
    return null;
  }
  const buckets = await GetModel(
    MarketingEventsModel,
    website.tenantId,
  ).countHourly({
    websiteIds: [website._id],
    since: new Date(since),
    until: new Date(since + hours * MS_PER_HOUR - 1),
    kind: reading.kind,
    perSession: reading.perSession,
    hiddenUrlPattern: hiddenDashboardUrlPattern(website),
  });
  const values = Array.from({ length: hours }, () => 0);
  for (const { hour, count } of buckets) {
    if (hour >= 0 && hour < hours) {
      values[hour] += count;
    }
  }
  return values;
}
