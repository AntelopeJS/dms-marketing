import {
  DEFAULT_QUERY_PERIOD_DAYS,
  MAX_QUERY_PERIOD_DAYS,
  MS_PER_DAY,
} from "@/types/constants";
import { queryString } from "./query-param";
import { getUtcMidnight } from "./rollup-write";

const PERIOD_PATTERN = /^(\d{1,3})d$/;

/**
 * "Nd" → clamped day count; anything else falls back to the default. Takes
 * `unknown` because it sits directly behind a query parameter, and an empty
 * one does not arrive as a string (see {@link queryString}).
 */
export function parsePeriodDays(period: unknown): number {
  const match = queryString(period)?.match(PERIOD_PATTERN);
  if (!match) {
    return DEFAULT_QUERY_PERIOD_DAYS;
  }
  return Math.min(Math.max(Number(match[1]), 1), MAX_QUERY_PERIOD_DAYS);
}

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
}

/** The query parameters a period-scoped block sends (see the DMS period scope). */
export interface PeriodQuery {
  from?: unknown;
  to?: unknown;
  compareFrom?: unknown;
  compareTo?: unknown;
  period?: unknown;
}

/** The period scope's parameters, read off a request URL as the scope sent them. */
export function periodQueryOf(url: URL): PeriodQuery {
  const params = url.searchParams;
  return {
    from: params.get("from") ?? undefined,
    to: params.get("to") ?? undefined,
    compareFrom: params.get("compareFrom") ?? undefined,
    compareTo: params.get("compareTo") ?? undefined,
    period: params.get("period") ?? undefined,
  };
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

function windowOfDays(firstDay: number, lastDay: number): QueryWindow {
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
  };
}

function boundedWindow(
  from: number | undefined,
  to: number | undefined,
): QueryWindow | null {
  if (from === undefined || to === undefined || to < from) {
    return null;
  }
  return windowOfDays(firstDayOf(from), lastDayOf(to));
}

/**
 * The window a read covers: `from`/`to` when a period scope sent them, else
 * the legacy `period=Nd` ending today. Longer than MAX_QUERY_PERIOD_DAYS is
 * cut at its start, so the most recent days always stay in.
 */
export function resolveQueryWindow(query: PeriodQuery): QueryWindow {
  const bounded = boundedWindow(
    parseInstant(query.from),
    parseInstant(query.to),
  );
  if (bounded) {
    return bounded;
  }
  const today = getUtcMidnight(new Date());
  const days = parsePeriodDays(query.period);
  return windowOfDays(today - (days - 1) * MS_PER_DAY, today);
}

/** The comparison window, or null when the scope compares with nothing. */
export function resolveCompareWindow(query: PeriodQuery): QueryWindow | null {
  return boundedWindow(
    parseInstant(query.compareFrom),
    parseInstant(query.compareTo),
  );
}

/** The same number of days right before `window`. */
export function previousWindow(window: QueryWindow): QueryWindow {
  const lastDay = window.firstDay - MS_PER_DAY;
  return windowOfDays(lastDay - (window.days - 1) * MS_PER_DAY, lastDay);
}

/** Every UTC midnight of the window, oldest first. */
export function windowDays(window: QueryWindow): number[] {
  return Array.from(
    { length: window.days },
    (_, index) => window.firstDay + index * MS_PER_DAY,
  );
}
