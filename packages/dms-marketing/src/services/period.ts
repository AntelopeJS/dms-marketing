import {
  DEFAULT_QUERY_PERIOD_DAYS,
  MAX_QUERY_PERIOD_DAYS,
  MS_PER_DAY,
} from "@/types/constants";
import { queryString } from "./query-param";
import { getUtcMidnight } from "./rollup-write";

/** First UTC midnight of an N-day window ending today. */
export function periodStart(days: number): Date {
  return new Date(getUtcMidnight(new Date()) - (days - 1) * MS_PER_DAY);
}

/**
 * A window of whole UTC days, the unit the rollups are stored in: `firstDay`
 * and `lastDay` are the UTC midnights of its first and last day, `since` and
 * `until` the instants a raw-event read covers.
 */
export interface QueryWindow {
  firstDay: number;
  lastDay: number;
  days: number;
  since: Date;
  until: Date;
  /**
   * The last day is the UTC day in progress: its counts are partial, so a
   * change compares it with the same share of the other window's day.
   */
  inProgress: boolean;
  /**
   * How far the reader's midnight sits before the UTC one (+2 h in Brussels
   * in summer), read off the `from` bound the period scope sent: a day is
   * drawn at its local midnight, under the date the reader picked.
   */
  localOffset: number;
}

/** The query parameters a period-scoped block sends (see the DMS period scope). */
export interface PeriodQuery {
  from?: unknown;
  to?: unknown;
  compareFrom?: unknown;
  compareTo?: unknown;
  /** The preset the period scope resolved its bounds from (`last-30-days`, `custom`). */
  preset?: unknown;
  /**
   * The DMS period comparison the bounds were resolved from
   * (`previous-period`, `previous-year`, `none`), sent beside them.
   */
  comparison?: unknown;
}

/** The period scope's parameters, read off a request URL as the scope sent them. */
export function periodQueryOf(url: URL): PeriodQuery {
  const params = url.searchParams;
  return {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    compareFrom: params.get("compareFrom") ?? undefined,
    compareTo: params.get("compareTo") ?? undefined,
    preset: params.get("preset") ?? undefined,
    comparison: params.get("comparison") ?? undefined,
  };
}

/** What the window is compared with, as a label names it. */
export type ComparisonKind = "previous-period" | "previous-year";

/** `previous-year` when the read names it, else the previous period. */
export function comparisonKindOf(query: PeriodQuery): ComparisonKind {
  return queryString(query.comparison) === "previous-year"
    ? "previous-year"
    : "previous-period";
}

function parseInstant(value: unknown): number | undefined {
  const raw = queryString(value);
  if (!raw) {
    return undefined;
  }
  const time = Date.parse(raw);
  return Number.isFinite(time) ? time : undefined;
}

/**
 * The period scope sends the bounds of local days (local midnight to local
 * 23:59:59.999). Rounding each bound to the nearest UTC midnight maps them on
 * the UTC day carrying the same date for any offset under twelve hours, which
 * is what the rollups key their rows on.
 */
function firstDayOf(instant: number): number {
  return Math.round(instant / MS_PER_DAY) * MS_PER_DAY;
}

function lastDayOf(instant: number): number {
  return Math.round((instant + 1) / MS_PER_DAY) * MS_PER_DAY - MS_PER_DAY;
}

function windowOfDays(
  firstDay: number,
  lastDay: number,
  localOffset = 0,
): QueryWindow {
  const capped = Math.max(
    firstDay,
    lastDay - (MAX_QUERY_PERIOD_DAYS - 1) * MS_PER_DAY,
  );
  const now = Date.now();
  return {
    firstDay: capped,
    lastDay,
    days: Math.round((lastDay - capped) / MS_PER_DAY) + 1,
    since: new Date(capped),
    until: new Date(Math.min(lastDay + MS_PER_DAY - 1, now)),
    inProgress: lastDay === getUtcMidnight(new Date(now)),
    localOffset,
  };
}

interface DayBounds {
  firstDay: number;
  lastDay: number;
  localOffset: number;
}

function boundedDays(
  from: number | undefined,
  to: number | undefined,
): DayBounds | null {
  if (from === undefined || to === undefined || to < from) {
    return null;
  }
  const firstDay = firstDayOf(from);
  return { firstDay, lastDay: lastDayOf(to), localOffset: firstDay - from };
}

/**
 * Days a window runs past the UTC day in progress. East of UTC the reader's
 * day starts first: from their midnight until the UTC one (00:00 to 02:00 in
 * Brussels in summer) "today" names a UTC day nothing was counted in yet,
 * while that hour's visits land in the current one. Such a window is moved
 * back to end on the current UTC day, the closest the daily rollups get to
 * the reader's own day.
 */
function daysAhead(bounds: DayBounds): number {
  return Math.max(0, bounds.lastDay - getUtcMidnight(new Date()));
}

function shiftedWindow(bounds: DayBounds, shift: number): QueryWindow {
  return windowOfDays(
    bounds.firstDay - shift,
    bounds.lastDay - shift,
    bounds.localOffset,
  );
}

function readBounds(query: PeriodQuery): DayBounds | null {
  return boundedDays(parseInstant(query.from), parseInstant(query.to));
}

/** The last `days` UTC days, today included. */
export function trailingWindow(days: number): QueryWindow {
  const today = getUtcMidnight(new Date());
  return windowOfDays(today - (days - 1) * MS_PER_DAY, today);
}

/**
 * The window a read covers: `from`/`to` when a period scope sent them, else
 * the last DEFAULT_QUERY_PERIOD_DAYS. Longer than MAX_QUERY_PERIOD_DAYS is
 * cut at its start, so the most recent days always stay in. The rollups keep
 * UTC days: a local day reads the UTC day of the same date (see
 * {@link firstDayOf} and {@link daysAhead}).
 */
export function resolveQueryWindow(query: PeriodQuery): QueryWindow {
  const bounds = readBounds(query);
  if (bounds) {
    return shiftedWindow(bounds, daysAhead(bounds));
  }
  return trailingWindow(DEFAULT_QUERY_PERIOD_DAYS);
}

/**
 * The comparison window the period scope sent (`compareFrom`/`compareTo`,
 * moved back as the read window is), or null when it compares with nothing.
 */
export function resolveCompareWindow(query: PeriodQuery): QueryWindow | null {
  const bounds = boundedDays(
    parseInstant(query.compareFrom),
    parseInstant(query.compareTo),
  );
  if (!bounds) {
    return null;
  }
  const read = readBounds(query);
  return shiftedWindow(bounds, read ? daysAhead(read) : 0);
}

/** The same number of days right before `window`. */
export function previousWindow(window: QueryWindow): QueryWindow {
  const lastDay = window.firstDay - MS_PER_DAY;
  return windowOfDays(
    lastDay - (window.days - 1) * MS_PER_DAY,
    lastDay,
    window.localOffset,
  );
}

/**
 * Share of the UTC day in progress already behind us, 1 for a window over
 * past days: what a comparison counts of its matching day, so a day still
 * being counted is set against as long a stretch of the other one.
 */
export function elapsedShare(window: QueryWindow): number {
  if (!window.inProgress) {
    return 1;
  }
  return Math.min(1, (Date.now() - window.lastDay) / MS_PER_DAY);
}

/** Every UTC midnight of the window, oldest first. */
export function windowDays(window: QueryWindow): number[] {
  return Array.from(
    { length: window.days },
    (_, index) => window.firstDay + index * MS_PER_DAY,
  );
}
