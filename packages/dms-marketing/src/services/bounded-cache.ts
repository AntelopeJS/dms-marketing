import { MAX_CACHE_ENTRIES } from "@/types/constants";

interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

/** A hit wraps its value, so caching a negative lookup stays a hit. */
export interface CacheHit<T> {
  value: T;
}

/**
 * Insertion-order eviction for a capped map: the oldest key goes only when a
 * NEW one would push the map past its cap.
 */
export function setBounded<T>(
  entries: Map<string, T>,
  key: string,
  value: T,
  maxEntries: number,
): void {
  if (!entries.has(key) && entries.size >= maxEntries) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) {
      entries.delete(oldest);
    }
  }
  entries.set(key, value);
}

/**
 * TTL cache with a hard entry cap: the public endpoints key lookups on
 * request parameters, so an unbounded Map is a memory sink any anonymous
 * caller can fill. A miss only costs the lookup the cache saves, so overflow
 * degrades throughput, not correctness. Expired entries are dropped on read.
 */
export class BoundedCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number = MAX_CACHE_ENTRIES,
  ) {}

  get(key: string): CacheHit<T> | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (Date.now() - entry.fetchedAt >= this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return { value: entry.value };
  }

  set(key: string, value: T): void {
    setBounded(
      this.entries,
      key,
      { value, fetchedAt: Date.now() },
      this.maxEntries,
    );
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
