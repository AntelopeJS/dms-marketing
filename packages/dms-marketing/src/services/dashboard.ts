import type { StatGroupItem } from "@antelopejs/interface-dms/base/stat-group";
import type { BlockText } from "@antelopejs/interface-dms/base/types/composed-text";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { FunnelsModel } from "@/db";
import type { WebsiteStatistics } from "@/db/tables/website_statistics.table";
import type { Website } from "@/db/tables/websites.table";
import type { TopDimension } from "@/types";
import {
  MARKETING_MODULE_PATH,
  MS_PER_DAY,
  MS_PER_HOUR,
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
import { HOURS_PER_DAY, hourlyValues } from "./hourly-traffic";
import type { ComparisonKind, QueryWindow } from "./period";
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

/**
 * The days a trend line draws: the day still being counted is left out, its
 * dip would read as a fall. Nothing for fewer than two days.
 */
function completeDays(values: number[], window: QueryWindow): number[] {
  const complete = window.inProgress ? values.slice(0, -1) : values;
  return complete.length > 1 ? complete : [];
}

/**
 * The value and its change. The comparison counts its day matching today for
 * as much of it as today has run (see `RollupRead.compareRows`), so the
 * change compares equal stretches of time.
 */
export function kpiPayload(read: RollupRead, metric: KpiMetric): KpiPayload {
  const value = KPI_METRICS[metric](sumRollups(read.rows));
  const previous = read.compare
    ? KPI_METRICS[metric](sumRollups(read.compareRows))
    : undefined;
  return {
    value,
    previousValue: previous === undefined ? undefined : Math.round(previous),
    delta: percentChange(value, previous) ?? undefined,
    sparkline: completeDays(
      dailyValues(read.rows, read.window, ROW_METRICS[metric]),
      read.window,
    ),
  };
}

interface ChartPoint {
  x: number;
  y: number | null;
}

interface ChartSeries {
  name: string;
  data: ChartPoint[];
  color?: string;
  strokeDashArray?: number;
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

/** The line a chart leads with, which the stretch still being counted continues. */
const PRIMARY_LINE_COLOR = "--dms-sparkline";
const PARTIAL_DASH = 4;

/** The points of a curve and the window they stand for. */
interface Curves {
  current: ChartPoint[];
  previous: ChartPoint[] | null;
  /** The last point is a day or an hour still being counted. */
  partial: boolean;
}

/**
 * Daily points drawn at the reader's midnight (see `QueryWindow.localOffset`)
 * so each sits under the date it was picked as. The comparison is drawn on
 * the read window's axis, day i of the previous period under day i of the
 * current one: the dashed line reads "the same point of the last period".
 */
function dayPoints(
  rows: readonly WebsiteStatistics[],
  window: QueryWindow,
  axis: QueryWindow,
  metric: KpiMetric,
): ChartPoint[] {
  const values = dailyValues(rows, window, ROW_METRICS[metric]);
  return values.map((y, index) => ({
    x: axis.firstDay - axis.localOffset + index * MS_PER_DAY,
    y,
  }));
}

function dailyCurves(read: RollupRead, metric: KpiMetric): Curves {
  return {
    current: dayPoints(read.rows, read.window, read.window, metric),
    previous: read.compare
      ? dayPoints(read.compareDays, read.compare, read.window, metric)
      : null,
    partial: read.window.inProgress,
  };
}

/**
 * A single day is drawn hour by hour, up to the hour in progress, from the
 * raw events: a lone daily point would leave the chart a dot on an axis
 * stretched over days that have not come. The comparison covers the same
 * hours of its own day. A day whose events are gone draws nothing.
 */
async function hourlyCurves(
  read: RollupRead,
  metric: KpiMetric,
  website: Website,
): Promise<Curves> {
  const since = read.window.firstDay;
  const hours = read.window.inProgress
    ? Math.floor((Date.now() - since) / MS_PER_HOUR) + 1
    : HOURS_PER_DAY;
  const [current, previous] = await Promise.all([
    hourlyValues(website, since, hours, metric),
    read.compare
      ? hourlyValues(website, read.compare.firstDay, hours, metric)
      : null,
  ]);
  const points = (values: number[]) => {
    const drawn = values.map((y: number | null, index) => ({
      x: since + index * MS_PER_HOUR,
      y,
    }));
    return drawn.length > 1
      ? drawn
      : [...drawn, { x: since + drawn.length * MS_PER_HOUR, y: null }];
  };
  return {
    current: current ? points(current) : [],
    previous: current && previous ? points(previous) : null,
    partial: read.window.inProgress && hours > 1,
  };
}

/**
 * The curve, its last stretch dashed while that day or hour is still being
 * counted: the line does not plunge to a value that is not final yet.
 */
function withPartialEnd(
  name: string,
  points: ChartPoint[],
  partial: boolean,
): ChartSeries[] {
  const last = points.length - 1;
  if (!partial || last < 1) {
    return [{ name, data: points }];
  }
  return [
    {
      name,
      data: points.map((point, index) =>
        index === last ? { x: point.x, y: null } : point,
      ),
    },
    {
      name: `${SERIES_NAME_PREFIX}in_progress`,
      data: points.map((point, index) =>
        index >= last - 1 ? point : { x: point.x, y: null },
      ),
      color: PRIMARY_LINE_COLOR,
      strokeDashArray: PARTIAL_DASH,
    },
  ];
}

/**
 * The traffic chart: one point per day, or per hour over a single day. Its
 * value and change are the KPI's own, so the card agrees with the KPI row.
 */
export async function trafficPayload(
  read: RollupRead,
  metric: KpiMetric,
  website: Website,
  comparison: ComparisonKind,
): Promise<TrafficPayload> {
  const kpi = kpiPayload(read, metric);
  const curves =
    read.window.days === 1
      ? await hourlyCurves(read, metric, website)
      : dailyCurves(read, metric);
  const previousName =
    comparison === "previous-year" ? "previous_year" : "previous";
  return {
    value: kpi.value,
    previousValue: kpi.previousValue,
    delta: kpi.delta,
    series: withPartialEnd(
      `${SERIES_NAME_PREFIX}${metric}`,
      curves.current,
      curves.partial,
    ),
    comparisonSeries: curves.previous
      ? [
          {
            name: `${SERIES_NAME_PREFIX}${previousName}`,
            data: curves.previous,
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
export function qualityItems(
  read: RollupRead,
  comparison: ComparisonKind,
): StatGroupItem[] {
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
      detail: deltaText(bounce, "points", comparison),
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
      detail: deltaText(duration, "seconds", comparison),
      detailTone: deltaTone(duration),
    },
    {
      id: "pages-per-session",
      eyebrow: `${QUALITY_PREFIX}pages_per_session`,
      icon: "i-ph-stack",
      value: decimalText(current.pagesPerSession),
      detail: deltaText(pages, "number", comparison),
      detailTone: deltaTone(pages),
    },
  ];
}

/** A row of a top list, in the DMS `TopListCard` item shape plus a share. */
export interface TopRow {
  id: string;
  title: string;
  value: number;
  description?: BlockText;
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

/**
 * Acquisition, on one channel's tab of the campaigns table (the table opens
 * the tab its URL names) or whole.
 */
export function acquisitionLink(channel?: string): string {
  const base = `${MARKETING_MODULE_PATH}/acquisition`;
  return channel ? `${base}?tab=${encodeURIComponent(channel)}` : base;
}

/** The funnel builder, a new funnel starting on this custom event. */
export function eventFunnelLink(name: string): string {
  const steps = JSON.stringify([{ kind: "custom", value: name }]);
  return `${MARKETING_MODULE_PATH}/funnel-builder?steps=${encodeURIComponent(steps)}`;
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

/**
 * Whether the read has countries to list: sessions carry one when the GeoIP
 * lookup stamped them, but also when an import declared it, so a deployment
 * without a GeoIP database still lists what it has.
 */
function hasCountries(read: RollupRead): boolean {
  const rows = [...read.rows, ...read.compareRows];
  return Object.keys(mergeDimension(rows, "topCountries")).length > 0;
}

const TOP_GROUPS = {
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
      link: () => acquisitionLink(),
    },
    {
      id: "referrers",
      label: `${GROUP_PREFIX}acquisition.tabs.referrers`,
      dimension: "topReferrers",
      link: () => acquisitionLink(),
    },
  ],
  audience: (read) => [
    ...(isGeoipActive() || hasCountries(read)
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
      link: eventFunnelLink,
    },
  ],
} satisfies Record<string, (read: RollupRead) => TopTabDefinition[]>;

/** A group of top lists the overview and the acquisition page draw as tabs. */
export type TopGroup = keyof typeof TOP_GROUPS;

export function isTopGroup(value: unknown): value is TopGroup {
  return typeof value === "string" && Object.hasOwn(TOP_GROUPS, value);
}

export function topGroupPayload(
  read: RollupRead,
  group: TopGroup,
): TopTabPayload[] {
  return TOP_GROUPS[group](read).map((tab) => topTab(read, tab));
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

const DEVICE_ICONS = new Map([
  ["desktop", "i-ph-desktop"],
  ["mobile", "i-ph-device-mobile"],
  ["tablet", "i-ph-device-tablet"],
]);

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
    description: percentText(shareOf(value, total)),
    delta: previous ? percentChange(value, previous[key]) : null,
    icon: DEVICE_ICONS.get(key) ?? DEFAULT_DEVICE_ICON,
  }));
}
