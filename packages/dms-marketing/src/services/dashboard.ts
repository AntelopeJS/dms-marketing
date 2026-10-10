import type { StatGroupItem } from "@antelopejs/interface-dms/base/stat-group";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { FunnelsModel } from "@/db";
import type { WebsiteStatistics } from "@/db/tables/website_statistics.table";
import type { Website } from "@/db/tables/websites.table";
import type { TopDimension } from "@/types";
import {
  MARKETING_MODULE_PATH,
  MS_PER_DAY,
  MS_PER_SECOND,
} from "@/types/constants";
import {
  decimalText,
  deltaText,
  deltaTone,
  durationText,
  percentText,
} from "./composed";
import { isGeoipActive } from "./geoip";
import type { QueryWindow } from "./period";
import {
  dailyValues,
  mergeDimension,
  percentChange,
  rankEntries,
  type RollupRead,
  type RollupTotals,
  shareOf,
  sumRollups,
} from "./rollups";

/** The four volume KPIs of the overview, by the id the page sends. */
export const KPI_METRICS = {
  pageviews: (totals: RollupTotals) => totals.pageviews,
  sessions: (totals: RollupTotals) => totals.sessions,
  "new-visitors": (totals: RollupTotals) => totals.newVisitors,
  "custom-events": (totals: RollupTotals) => totals.customEvents,
} as const;

export type KpiMetric = keyof typeof KPI_METRICS;

const ROW_METRICS: Record<KpiMetric, (row: WebsiteStatistics) => number> = {
  pageviews: (row) => row.pageviews,
  sessions: (row) => row.sessions,
  "new-visitors": (row) => row.newVisitors,
  "custom-events": (row) => row.customEvents,
};

export function isKpiMetric(value: unknown): value is KpiMetric {
  return typeof value === "string" && Object.hasOwn(KPI_METRICS, value);
}

/** The payload a DMS `KpiCard` reads. */
export interface KpiPayload {
  value: number;
  previousValue?: number;
  delta?: number;
  sparkline: number[];
}

export function kpiPayload(read: RollupRead, metric: KpiMetric): KpiPayload {
  const value = KPI_METRICS[metric](sumRollups(read.rows));
  const previousValue = read.compare
    ? KPI_METRICS[metric](sumRollups(read.compareRows))
    : undefined;
  return {
    value,
    previousValue,
    delta: percentChange(value, previousValue) ?? undefined,
    sparkline: dailyValues(read.rows, read.window, ROW_METRICS[metric]),
  };
}

interface ChartPoint {
  x: number;
  y: number;
}

interface ChartSeries {
  name: string;
  data: ChartPoint[];
}

/** The payload a DMS `ChartCard` reads. */
export interface TrafficPayload {
  value: number;
  previousValue?: number;
  delta?: number;
  series: ChartSeries[];
  comparisonSeries?: ChartSeries[];
}

const SERIES_NAME_PREFIX = "$page.marketing.overview.traffic.series.";

function seriesOf(
  rows: readonly WebsiteStatistics[],
  window: QueryWindow,
  axis: QueryWindow,
  metric: KpiMetric,
): ChartPoint[] {
  const values = dailyValues(rows, window, ROW_METRICS[metric]);
  return values.map((y, index) => ({
    x: axis.firstDay + index * MS_PER_DAY,
    y,
  }));
}

/**
 * The comparison series is drawn on the primary window's axis, day i of the
 * previous period under day i of the current one, which is how the dashed
 * line reads "the same point of the last period".
 */
export function trafficPayload(
  read: RollupRead,
  metric: KpiMetric,
): TrafficPayload {
  const kpi = kpiPayload(read, metric);
  const name = `${SERIES_NAME_PREFIX}${metric}`;
  return {
    value: kpi.value,
    previousValue: kpi.previousValue,
    delta: kpi.delta,
    series: [
      { name, data: seriesOf(read.rows, read.window, read.window, metric) },
    ],
    comparisonSeries: read.compare
      ? [
          {
            name: `${SERIES_NAME_PREFIX}previous`,
            data: seriesOf(read.compareRows, read.compare, read.window, metric),
          },
        ]
      : undefined,
  };
}

interface SessionQuality {
  bounceRate: number | null;
  averageDurationSeconds: number | null;
  pagesPerSession: number | null;
}

function qualityOf(totals: RollupTotals): SessionQuality {
  if (totals.sessions === 0) {
    return {
      bounceRate: null,
      averageDurationSeconds: null,
      pagesPerSession: null,
    };
  }
  return {
    // Transition-counted bounces can sum below zero on a window cutting a
    // session in two; a negative rate is never worth showing.
    bounceRate: (Math.max(0, totals.bouncedSessions) / totals.sessions) * 100,
    averageDurationSeconds:
      totals.sessionDurationMs / totals.sessions / MS_PER_SECOND,
    pagesPerSession: totals.pageviews / totals.sessions,
  };
}

function difference(
  current: number | null,
  previous: number | null | undefined,
) {
  return current === null || previous === null || previous === undefined
    ? null
    : current - previous;
}

const QUALITY_PREFIX = "$page.marketing.overview.quality.";

/**
 * The session quality strip, as stock `StatGroup` cells: values and changes
 * are composed texts, written in the reader's language by the dashboard.
 */
export function qualityItems(read: RollupRead): StatGroupItem[] {
  const current = qualityOf(sumRollups(read.rows));
  const previous = read.compare
    ? qualityOf(sumRollups(read.compareRows))
    : undefined;
  const bounce = difference(current.bounceRate, previous?.bounceRate);
  const duration = difference(
    current.averageDurationSeconds,
    previous?.averageDurationSeconds,
  );
  const pages = difference(current.pagesPerSession, previous?.pagesPerSession);
  return [
    {
      id: "bounce-rate",
      eyebrow: `${QUALITY_PREFIX}bounce_rate`,
      icon: "i-ph-arrow-u-up-left",
      value: percentText(current.bounceRate),
      detail: deltaText(bounce, "points"),
      detailTone: deltaTone(bounce, true),
    },
    {
      id: "duration",
      eyebrow: `${QUALITY_PREFIX}avg_session_duration`,
      icon: "i-ph-timer",
      value:
        current.averageDurationSeconds === null
          ? "—"
          : durationText(current.averageDurationSeconds),
      detail: deltaText(duration, "seconds"),
      detailTone: deltaTone(duration),
    },
    {
      id: "pages-per-session",
      eyebrow: `${QUALITY_PREFIX}pages_per_session`,
      icon: "i-ph-stack",
      value: decimalText(current.pagesPerSession),
      detail: deltaText(pages, "number"),
      detailTone: deltaTone(pages),
    },
  ];
}

/** A row of a top list, in the DMS `TopListCard` item shape plus a share. */
export interface TopRow {
  id: string;
  title: string;
  value: number;
  description?: string;
  share: number;
  delta?: number | null;
  to?: string;
  icon?: string;
  tag?: string;
}

/** How a tab names its keys: as stored, as an i18n key, or for `Intl` on the client. */
export type TopLabelKind =
  | "raw"
  | "channel"
  | "country"
  | "language"
  | "device";

export interface TopTabDefinition {
  id: string;
  label: string;
  dimension: TopDimension;
  labelKind?: TopLabelKind;
  link?: (key: string) => string;
}

export interface TopTabPayload {
  id: string;
  label: string;
  labelKind: TopLabelKind;
  total: number;
  items: TopRow[];
}

const TOP_LIST_LIMIT = 8;

export function pagesLink(path?: string): string {
  const base = `${MARKETING_MODULE_PATH}/pages`;
  return path ? `${base}?path=${encodeURIComponent(path)}` : base;
}

export function acquisitionLink(): string {
  return `${MARKETING_MODULE_PATH}/acquisition`;
}

function topTab(read: RollupRead, tab: TopTabDefinition): TopTabPayload {
  const merged = mergeDimension(read.rows, tab.dimension);
  const previous = read.compare
    ? mergeDimension(read.compareRows, tab.dimension)
    : undefined;
  const total = Object.values(merged).reduce(
    (sum, value) => sum + Math.max(0, value),
    0,
  );
  const items = rankEntries(merged, TOP_LIST_LIMIT).map(({ key, value }) => ({
    id: key,
    title: key,
    value,
    share: shareOf(value, total),
    delta: previous ? percentChange(value, previous[key]) : undefined,
    to: tab.link?.(key),
  }));
  return {
    id: tab.id,
    label: tab.label,
    labelKind: tab.labelKind ?? "raw",
    total,
    items,
  };
}

const GROUP_PREFIX = "$page.marketing.overview.groups.";

const TOP_GROUPS: Record<string, () => TopTabDefinition[]> = {
  content: () => [
    {
      id: "pages",
      label: `${GROUP_PREFIX}content.tabs.pages`,
      dimension: "topPages",
      link: pagesLink,
    },
    {
      id: "entry",
      label: `${GROUP_PREFIX}content.tabs.entry`,
      dimension: "topEntryPages",
      link: pagesLink,
    },
    {
      id: "exit",
      label: `${GROUP_PREFIX}content.tabs.exit`,
      dimension: "topExitPages",
      link: pagesLink,
    },
  ],
  acquisition: () => [
    {
      id: "channels",
      label: `${GROUP_PREFIX}acquisition.tabs.channels`,
      dimension: "topChannels",
      labelKind: "channel",
      link: acquisitionLink,
    },
    {
      id: "campaigns",
      label: `${GROUP_PREFIX}acquisition.tabs.campaigns`,
      dimension: "topUtmCampaigns",
      link: acquisitionLink,
    },
    {
      id: "referrers",
      label: `${GROUP_PREFIX}acquisition.tabs.referrers`,
      dimension: "topReferrers",
    },
  ],
  audience: () => [
    ...(isGeoipActive()
      ? [
          {
            id: "countries",
            label: `${GROUP_PREFIX}audience.tabs.countries`,
            dimension: "topCountries" as const,
            labelKind: "country" as const,
          },
        ]
      : []),
    {
      id: "languages",
      label: `${GROUP_PREFIX}audience.tabs.languages`,
      dimension: "topLanguages",
      labelKind: "language",
    },
    {
      id: "browsers",
      label: `${GROUP_PREFIX}audience.tabs.browsers`,
      dimension: "topBrowsers",
    },
  ],
  events: () => [
    {
      id: "events",
      label: `${GROUP_PREFIX}events.tabs.events`,
      dimension: "topEvents",
    },
  ],
};

export function isTopGroup(value: unknown): value is string {
  return typeof value === "string" && Object.hasOwn(TOP_GROUPS, value);
}

export function topGroupPayload(
  read: RollupRead,
  group: string,
): TopTabPayload[] {
  return TOP_GROUPS[group]().map((tab) => topTab(read, tab));
}

/** Custom events a funnel of the site ends on: the overview tags them "Goal". */
export async function goalEventNames(website: Website): Promise<Set<string>> {
  const funnels = await GetModel(FunnelsModel, website.tenantId).listByWebsite(
    website._id,
  );
  const goals = new Set<string>();
  for (const funnel of funnels) {
    const last = funnel.steps.at(-1);
    if (last?.kind === "custom") {
      goals.add(last.value);
    }
  }
  return goals;
}

const DEVICE_ICONS: Record<string, string> = {
  desktop: "i-ph-desktop",
  mobile: "i-ph-device-mobile",
  tablet: "i-ph-device-tablet",
};

const DEFAULT_DEVICE_ICON = "i-ph-devices";

export function devicesPayload(read: RollupRead): TopRow[] {
  const merged = mergeDimension(read.rows, "topDevices");
  const previous = read.compare
    ? mergeDimension(read.compareRows, "topDevices")
    : undefined;
  const total = Object.values(merged).reduce(
    (sum, value) => sum + Math.max(0, value),
    0,
  );
  return rankEntries(merged).map(({ key, value }) => ({
    id: key,
    title: `$page.marketing.devices.${key}`,
    value,
    share: shareOf(value, total),
    description: `${shareOf(value, total).toFixed(0)}%`,
    delta: previous ? percentChange(value, previous[key]) : null,
    icon: DEVICE_ICONS[key] ?? DEFAULT_DEVICE_ICON,
  }));
}
