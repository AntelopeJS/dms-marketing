import { isBot } from "ua-parser-js/helpers";
import {
  COLLECT_RATE_LIMIT_WINDOW_MS,
  MAX_EVENTS_PER_WINDOW_PER_SOURCE,
  MAX_SNAPSHOTS_PER_WINDOW_PER_SOURCE,
  RATE_LIMIT_MAX_SOURCES,
} from "@/types/constants";
import { setBounded } from "./bounded-cache";

const AUTOMATION_UA_PATTERN = /headless|phantomjs|slimerjs/i;

export function isAutomatedClient(userAgent: string): boolean {
  return (
    userAgent === "" ||
    AUTOMATION_UA_PATTERN.test(userAgent) ||
    isBot(userAgent)
  );
}

interface WindowEntry {
  windowStart: number;
  count: number;
}

export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, WindowEntry>();

  constructor(
    private readonly windowMs: number,
    private readonly maxPerWindow: number,
    private readonly maxSources: number,
  ) {}

  consume(key: string, amount: number): boolean {
    const now = Date.now();
    const entry = this.entries.get(key);
    const inWindow =
      entry !== undefined && now - entry.windowStart < this.windowMs;
    const used = inWindow ? entry.count : 0;
    if (used + amount > this.maxPerWindow) {
      return false;
    }
    if (inWindow) {
      entry.count += amount;
    } else {
      setBounded(
        this.entries,
        key,
        { windowStart: now, count: amount },
        this.maxSources,
      );
    }
    return true;
  }
}

export const collectRateLimiter = new FixedWindowRateLimiter(
  COLLECT_RATE_LIMIT_WINDOW_MS,
  MAX_EVENTS_PER_WINDOW_PER_SOURCE,
  RATE_LIMIT_MAX_SOURCES,
);

export const snapshotRateLimiter = new FixedWindowRateLimiter(
  COLLECT_RATE_LIMIT_WINDOW_MS,
  MAX_SNAPSHOTS_PER_WINDOW_PER_SOURCE,
  RATE_LIMIT_MAX_SOURCES,
);
