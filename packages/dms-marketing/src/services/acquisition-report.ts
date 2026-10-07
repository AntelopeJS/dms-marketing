import type { WebsiteStatistics } from "@/db/tables/website_statistics.table";
import { MARKETING_CHANNELS, type MarketingChannel } from "@/types";
import { resolveChannel, splitCampaignKey } from "./acquisition";
import type { QueryWindow } from "./period";
import {
  mergeDimension,
  percentChange,
  type RollupRead,
  shareOf,
  sumRollups,
} from "./rollups";
import { windowDays } from "./period";

export interface ChannelRow {
  id: MarketingChannel;
  sessions: number;
  share: number;
  /** Change of the share vs the comparison window, in percent. */
  delta: number | null;
}

export interface ChannelsPayload {
  total: number;
  items: ChannelRow[];
}

/** Every channel, in display order, even at zero: the split is exhaustive. */
export function channelsPayload(read: RollupRead): ChannelsPayload {
  const current = mergeDimension(read.rows, "topChannels");
  const previous = read.compare
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
  };
}

export interface CampaignRow {
  key: string;
  source?: string;
  medium?: string;
  campaign?: string;
  /** The channel the row's sessions land in when they carry no referrer. */
  channel: MarketingChannel;
  sessions: number;
  share: number;
  /** Sessions per day over the window, for the row's sparkline. */
  daily: number[];
  /** Tagged but without utm_medium: these sessions count as direct. */
  missingMedium: boolean;
}

export interface CampaignsPayload {
  rows: CampaignRow[];
  truncated: boolean;
  totalSessions: number;
  taggedSessions: number;
  missingMediumSessions: number;
}

const MAX_CAMPAIGN_ROWS = 100;

function dailyOf(
  rows: readonly WebsiteStatistics[],
  window: QueryWindow,
  key: string,
): number[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return windowDays(window).map(
    (day) => byDay.get(day)?.tops?.topCampaigns?.[key] ?? 0,
  );
}

function matches(row: CampaignRow, needle: string): boolean {
  return [row.source, row.medium, row.campaign].some((part) =>
    part?.toLowerCase().includes(needle),
  );
}

function toCampaignRow(
  read: RollupRead,
  key: string,
  sessions: number,
  totalSessions: number,
): CampaignRow {
  const parts = splitCampaignKey(key);
  return {
    key,
    ...parts,
    channel: resolveChannel(undefined, parts.medium),
    sessions,
    share: shareOf(sessions, totalSessions),
    daily: dailyOf(read.rows, read.window, key),
    missingMedium: !parts.medium,
  };
}

export function campaignsPayload(
  read: RollupRead,
  search: string | undefined,
): CampaignsPayload {
  const totalSessions = sumRollups(read.rows).sessions;
  const needle = search?.toLowerCase() ?? "";
  const all = Object.entries(mergeDimension(read.rows, "topCampaigns"))
    .filter(([, sessions]) => sessions > 0)
    .map(([key, sessions]) => toCampaignRow(read, key, sessions, totalSessions))
    .sort((a, b) => b.sessions - a.sessions);
  const matching = needle ? all.filter((row) => matches(row, needle)) : all;
  const sum = (rows: CampaignRow[]) =>
    rows.reduce((total, row) => total + row.sessions, 0);
  return {
    rows: matching.slice(0, MAX_CAMPAIGN_ROWS),
    truncated: matching.length > MAX_CAMPAIGN_ROWS,
    totalSessions,
    taggedSessions: sum(all),
    missingMediumSessions: sum(all.filter((row) => row.missingMedium)),
  };
}
