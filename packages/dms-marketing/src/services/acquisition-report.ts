import type { BannerContent } from "@antelopejs/interface-dms/base/banner";
import type { ComposedText } from "@antelopejs/interface-dms/base/types/composed-text";
import type { Website } from "@/db/tables/websites.table";
import { BoundedCache } from "./bounded-cache";
import { percentOf, percentText } from "./composed";
import { MARKETING_CHANNELS, type MarketingChannel } from "@/types";
import { splitCampaignKey } from "./acquisition";
import {
  mergeDimension,
  percentChange,
  type RollupRead,
  readRollups,
  shareOf,
  sumRollups,
} from "./rollups";
import { type QueryWindow, windowDays } from "./period";

export interface ChannelRow {
  id: MarketingChannel;
  sessions: number;
  share: number;
  /** Change of the channel's sessions vs the comparison window, in percent. */
  delta: number | null;
}

export interface ChannelsPayload {
  total: number;
  items: ChannelRow[];
  /**
   * The comparison window has sessions but no channel split left to compare
   * with: its days are past TOP_MAPS_RETENTION_DAYS, or were rolled up before
   * the dimension existed. Every delta is then null.
   */
  compareUnavailable: boolean;
  /**
   * The period is compared with a window that has rows: without one (no
   * comparison chosen, or none to read), the card leaves its change column
   * out instead of a column of dashes.
   */
  compared: boolean;
}

/**
 * Whether the comparison rows still carry their top maps. Every day with a
 * new session counts its channel, so a day with sessions and no channel map
 * had its maps emptied: comparing a top list with it would read as growth.
 */
export function compareHasTops(read: RollupRead): boolean {
  return read.compareRows.every(
    (row) =>
      row.sessions <= 0 || Object.keys(row.tops?.topChannels ?? {}).length > 0,
  );
}

/** Every channel, in display order, even at zero: the split is exhaustive. */
export function channelsPayload(read: RollupRead): ChannelsPayload {
  const current = mergeDimension(read.rows, "topChannels");
  const comparable = read.compare !== null && compareHasTops(read);
  const previous = comparable
    ? mergeDimension(read.compareRows, "topChannels")
    : undefined;
  const total = sumRollups(read.rows).sessions;
  return {
    total,
    items: MARKETING_CHANNELS.map((id) => {
      const sessions = current[id] ?? 0;
      return {
        id,
        sessions,
        share: shareOf(sessions, total),
        delta: previous ? percentChange(sessions, previous[id]) : null,
      };
    }).sort((a, b) => b.sessions - a.sessions),
    compareUnavailable: read.compare !== null && !comparable,
    compared: read.compare !== null,
  };
}

export interface CampaignRow {
  key: string;
  source?: string;
  medium?: string;
  campaign?: string;
  /** The channel the row's sessions were counted under. */
  channel: MarketingChannel;
  sessions: number;
  share: number;
  /** Sessions per day over the window, for the row's sparkline. */
  daily: number[];
  /** Tagged but without utm_medium: the referrer alone gave the channel. */
  missingMedium: boolean;
}

export interface CampaignsReport {
  /** Every row of the window, by sessions. */
  rows: CampaignRow[];
  totalSessions: number;
}

/**
 * Every campaign row of the window, one per source × medium × campaign and
 * the channel its sessions were counted under.
 */
export function campaignsReport(
  read: Pick<RollupRead, "rows" | "window">,
): CampaignsReport {
  const totalSessions = sumRollups(read.rows).sessions;
  const days = windowDays(read.window);
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  const byKey = new Map<string, CampaignRow>();
  for (const day of read.rows) {
    const index = dayIndex.get(day.day);
    for (const [key, count] of Object.entries(day.tops?.topCampaigns ?? {})) {
      const parts = splitCampaignKey(key);
      if (!parts) {
        continue;
      }
      const row = byKey.get(key) ?? {
        key,
        ...parts,
        sessions: 0,
        share: 0,
        daily: days.map(() => 0),
        missingMedium: !parts.medium,
      };
      row.sessions += count;
      if (index !== undefined) {
        row.daily[index] += count;
      }
      byKey.set(key, row);
    }
  }
  const rows = [...byKey.values()]
    .filter((row) => row.sessions > 0)
    .map((row) => ({ ...row, share: shareOf(row.sessions, totalSessions) }))
    .sort((a, b) => b.sessions - a.sessions);
  return { rows, totalSessions };
}

/**
 * One page load reads the report once per table list, tab counter and
 * notice: they share it for a few seconds instead of reading the window's
 * rollups each time. The promise is kept, so reads landing together share
 * the one in flight.
 */
const REPORT_TTL_MS = 10_000;
const reports = new BoundedCache<Promise<CampaignsReport>>(REPORT_TTL_MS);

export function readCampaignsReport(
  website: Website,
  window: QueryWindow,
): Promise<CampaignsReport> {
  const key = `${website.tenantId}:${website._id}:${window.firstDay}:${window.lastDay}`;
  const hit = reports.get(key);
  if (hit) {
    return hit.value;
  }
  const report = readRollups(website, window).then((rows) =>
    campaignsReport({ rows, window }),
  );
  reports.set(key, report);
  report.catch(() => reports.delete(key));
  return report;
}

/** A row of the campaigns table, the shape `TableView.fromSource` lists. */
export interface CampaignTableRow {
  _id: string;
  campaign: string | null;
  source: string | null;
  medium: string | null;
  channel: MarketingChannel;
  sessions: number;
  /** The row's share of the period's sessions, under its sessions. */
  share: ComposedText;
  daily: number[];
  missingMedium: boolean;
}

/** The list query of the campaigns table, as the stock table sends it. */
export interface CampaignTableQuery {
  search?: string;
  /** `filter_channel`: `<mode>:<value>`. */
  channel?: string;
  sortKey?: string;
  sortDirection?: string;
  offset?: number;
  limit?: number;
}

const SORT_KEYS = ["campaign", "source", "medium", "sessions"] as const;

type SortKey = (typeof SORT_KEYS)[number];

function isSortKey(value: string): value is SortKey {
  return SORT_KEYS.some((key) => key === value);
}

function matches(row: CampaignRow, needle: string): boolean {
  return [row.source, row.medium, row.campaign].some((part) =>
    part?.toLowerCase().includes(needle),
  );
}

/**
 * The modes the table offers on a select column. Every row has a channel, so
 * "is empty" keeps none and "is not empty" all; an unknown mode filters
 * nothing.
 */
function channelMatcher(
  filter: string | undefined,
): (channel: MarketingChannel) => boolean {
  if (!filter) {
    return () => true;
  }
  const separator = filter.indexOf(":");
  const mode = separator < 0 ? filter : filter.slice(0, separator);
  const values = new Set(
    separator < 0 ? [] : filter.slice(separator + 1).split(","),
  );
  switch (mode) {
    case "is":
      return (channel) => values.has(channel);
    case "is_not":
      return (channel) => !values.has(channel);
    case "is_empty":
      return () => false;
    default:
      return () => true;
  }
}

function byField(key: SortKey): (a: CampaignRow, b: CampaignRow) => number {
  if (key === "sessions") {
    return (a, b) => a.sessions - b.sessions;
  }
  return (a, b) =>
    (a[key] ?? "").localeCompare(b[key] ?? "", undefined, {
      numeric: true,
    });
}

/**
 * `{ results, total }` for the campaigns table: the route searches, filters,
 * sorts and pages every row of the period, so a channel tab or a search
 * reaches rows a first page would never hold and `total` counts them all.
 */
export function campaignTablePayload(
  report: CampaignsReport,
  query: CampaignTableQuery,
) {
  const needle = query.search?.trim().toLowerCase() ?? "";
  const inChannel = channelMatcher(query.channel);
  const matching = report.rows.filter(
    (row) => inChannel(row.channel) && (!needle || matches(row, needle)),
  );
  const sortKey =
    query.sortKey && isSortKey(query.sortKey) ? query.sortKey : undefined;
  const direction = query.sortDirection === "desc" ? -1 : 1;
  const sorted = sortKey
    ? [...matching].sort((a, b) => direction * byField(sortKey)(a, b))
    : matching;
  const offset = Math.max(0, query.offset ?? 0);
  const page = query.limit ? sorted.slice(offset, offset + query.limit) : [];
  return {
    results: page.map((row) => ({
      _id: row.key,
      campaign: row.campaign ?? null,
      source: row.source ?? null,
      medium: row.medium ?? null,
      channel: row.channel,
      sessions: row.sessions,
      share: percentOf(row.share),
      daily: row.daily,
      missingMedium: row.missingMedium,
    })),
    total: matching.length,
  } satisfies { results: CampaignTableRow[]; total: number };
}

const CAMPAIGNS_PREFIX = "$page.marketing.acquisition.campaigns.";

/** What a campaigns notice banner can tell. */
export type CampaignNoticeKind = "tagged" | "missing";

export function isCampaignNoticeKind(
  value: unknown,
): value is CampaignNoticeKind {
  return value === "tagged" || value === "missing";
}

function sessionsOf(rows: CampaignRow[]): number {
  return rows.reduce((total, row) => total + row.sessions, 0);
}

/**
 * A banner above the campaigns table, as a stock `Banner` reads it: the
 * tagged sessions and their share of the traffic, or the sessions tagged
 * without a medium; `null` when there is nothing to tell.
 */
export function campaignNotice(
  report: CampaignsReport,
  kind: CampaignNoticeKind,
): BannerContent | null {
  if (kind === "tagged") {
    const tagged = sessionsOf(report.rows);
    return tagged > 0
      ? {
          tone: "info",
          size: "sm",
          icon: "i-ph-tag",
          title: {
            key: `${CAMPAIGNS_PREFIX}tagged`,
            params: {
              count: { type: "count", value: tagged },
              share: percentText(shareOf(tagged, report.totalSessions)),
            },
          },
        }
      : null;
  }
  const missing = sessionsOf(report.rows.filter((row) => row.missingMedium));
  return missing > 0
    ? {
        tone: "warning",
        size: "sm",
        title: {
          key: `${CAMPAIGNS_PREFIX}missing_title`,
          params: { count: { type: "count", value: missing } },
        },
        description: `${CAMPAIGNS_PREFIX}missing_description`,
      }
    : null;
}
