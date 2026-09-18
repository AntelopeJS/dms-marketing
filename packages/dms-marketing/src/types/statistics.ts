/**
 * The top-N dimensions a rollup day carries, in wire order. Single source of
 * truth for the empty maps, the delta application, the retention trim and
 * the overview read: adding a dimension is this entry plus its extractor in
 * `services/collect`. `topPages` counts pageviews and `topEvents` counts
 * custom events by name; the others count sessions, once per visit —
 * `topExitPages` by moving that one count onto
 * each batch's new exit page. `topCampaigns` keys are composite
 * source × medium × campaign triples (see `services/acquisition`) and
 * `topChannels` keys the MARKETING_CHANNELS classification.
 */
export const TOP_DIMENSIONS = [
  "topPages",
  "topEntryPages",
  "topExitPages",
  "topReferrers",
  "topUtmSources",
  "topUtmMediums",
  "topUtmCampaigns",
  "topUtmTerms",
  "topUtmContents",
  "topCampaigns",
  "topChannels",
  "topDevices",
  "topBrowsers",
  "topCountries",
  "topEvents",
  "topLanguages",
] as const;

/**
 * Acquisition channels, in display order. A channel is never stored on the
 * session: it is a pure mapping of (referrerDomain, utmMedium, clickIdParam)
 * resolved when the session's rollup increment fires, so the mapping can
 * evolve without a migration.
 */
export const MARKETING_CHANNELS = [
  "direct",
  "organic",
  "social",
  "referral",
  "paid",
] as const;

export type MarketingChannel = (typeof MARKETING_CHANNELS)[number];

export type TopDimension = (typeof TOP_DIMENSIONS)[number];

/**
 * One value per dimension, keyed by dimension. The rollup maps, the collect
 * delta and the overview read each build exactly this record, cast included —
 * `Object.fromEntries` cannot know the keys cover the union.
 */
export function byDimension<T>(
  make: (dimension: TopDimension) => T,
): Record<TopDimension, T> {
  return Object.fromEntries(
    TOP_DIMENSIONS.map((dimension) => [dimension, make(dimension)]),
  ) as Record<TopDimension, T>;
}

export type TopEntries = Record<string, number>;

/**
 * Scalar counters of one day; the top-N maps are added by the type below.
 * Spelled out on purpose — unlike the dimensions, they are summed in two
 * places and a descriptor would cost more than the lines it saves.
 */
export interface MarketingDayCounters {
  day: number;
  pageviews: number;
  sessions: number;
  newVisitors: number;
  customEvents: number;
  /** Sessions currently at exactly one pageview. Counted as transitions, so
   * a day can go negative when it un-bounces sessions opened the day before;
   * period sums stay right and reads clamp at zero. */
  bouncedSessions: number;
  /** Sum of observed activity spans (last beacon minus first) of the
   * sessions active that day, each batch adding its own extension. */
  sessionDurationMs: number;
}

/**
 * One day of aggregated marketing activity for a website. `day` is the
 * timestamp at midnight UTC (ms), matching dms-api's DayStatistics so the
 * chart plumbing can be shared. Past TOP_MAPS_RETENTION_DAYS the maps are
 * emptied and the scalars kept, which keeps every rollup row bounded.
 */
export type MarketingDayStatistics = MarketingDayCounters &
  Record<TopDimension, TopEntries>;

export interface MarketingStatsDelta {
  pageviews: number;
  sessions: number;
  newVisitors: number;
  customEvents: number;
  /** May be negative: a batch giving a bounced session its second pageview
   * takes the bounce back. */
  bouncedSessions: number;
  sessionDurationMs: number;
  tops: Record<TopDimension, string[]>;
  /** Values to decrement — the previous exit page of a session whose exit
   * moved this batch. Absent dimensions drop nothing. */
  drops: Partial<Record<TopDimension, string[]>>;
}

export interface UtmFields {
  source?: string;
  medium?: string;
  campaign?: string;
  term?: string;
  content?: string;
}

export interface DeviceInfo {
  browser?: string;
  os?: string;
  deviceType?: string;
}
