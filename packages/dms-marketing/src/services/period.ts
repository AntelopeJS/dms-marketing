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
