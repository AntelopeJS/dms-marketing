import { randomUUID } from "node:crypto";
import type { MarketingSessionsModel } from "@/db";
import type { MarketingSession } from "@/db/tables/marketing_sessions.table";
import type { DeviceInfo, UtmFields } from "@/types";
import { SESSION_CACHE_MAX_ENTRIES } from "@/types/constants";
import { setBounded } from "./bounded-cache";
import { KeyedQueue } from "./keyed-queue";

export interface SessionInput {
  websiteId: string;
  visitorId: string;
  now: Date;
  sessionIdleTimeoutMs: number;
  entryUrl: string;
  referrerDomain?: string;
  utm: UtmFields;
  clickIdParam?: string;
  device: DeviceInfo;
  screen?: string;
  language?: string;
  country?: string;
}

export interface SessionResolution {
  session: MarketingSession;
  isNewSession: boolean;
  isNewVisitor: boolean;
}

/**
 * Per-instance session cache, keyed by website+visitor, bounded by insertion
 * order eviction; a miss falls back to the database.
 */
const sessionCache = new Map<string, MarketingSession>();

/**
 * The find-then-insert below is two queries; unserialized, two concurrent
 * batches of one visitor (two tabs on a first hit) would both miss, both find
 * nothing and both insert — counting one visit as two sessions and two new
 * visitors. Chaining per website+visitor closes that window on this instance:
 * the queued batch re-reads the cache the batch ahead of it just filled.
 * Parallel instances resolve against the database row the other instance
 * wrote, so only their simultaneous first hits can still race.
 */
const resolving = new KeyedQueue();

function cacheKey(websiteId: string, visitorId: string): string {
  return `${websiteId}:${visitorId}`;
}

function cacheSession(key: string, session: MarketingSession): void {
  setBounded(sessionCache, key, session, SESSION_CACHE_MAX_ENTRIES);
}

function isFresh(session: MarketingSession, input: SessionInput): boolean {
  const elapsed = input.now.getTime() - session.lastSeenAt.getTime();
  return elapsed < input.sessionIdleTimeoutMs;
}

function cachedResolution(
  key: string,
  input: SessionInput,
): SessionResolution | undefined {
  const cached = sessionCache.get(key);
  if (!cached || !isFresh(cached, input)) {
    return undefined;
  }
  return { session: cached, isNewSession: false, isNewVisitor: false };
}

export async function resolveSession(
  model: MarketingSessionsModel,
  input: SessionInput,
): Promise<SessionResolution> {
  const key = cacheKey(input.websiteId, input.visitorId);
  const cached = cachedResolution(key, input);
  if (cached) {
    return cached;
  }
  return resolving.run(key, () => resolveUncached(model, input, key));
}

async function resolveUncached(
  model: MarketingSessionsModel,
  input: SessionInput,
  key: string,
): Promise<SessionResolution> {
  const cached = cachedResolution(key, input);
  if (cached) {
    return cached;
  }

  const latest = await model.findLatestForVisitor(
    input.websiteId,
    input.visitorId,
  );
  if (latest && isFresh(latest, input)) {
    cacheSession(key, latest);
    return { session: latest, isNewSession: false, isNewVisitor: false };
  }

  const session = await createSession(model, input, latest === undefined);
  cacheSession(key, session);
  return { session, isNewSession: true, isNewVisitor: latest === undefined };
}

async function createSession(
  model: MarketingSessionsModel,
  input: SessionInput,
  isNewVisitor: boolean,
): Promise<MarketingSession> {
  const session = {
    _id: randomUUID(),
    websiteId: input.websiteId,
    visitorId: input.visitorId,
    startedAt: input.now,
    lastSeenAt: input.now,
    isNewVisitor,
    entryUrl: input.entryUrl,
    exitUrl: input.entryUrl,
    pageviewsCount: 0,
    eventsCount: 0,
    referrerDomain: input.referrerDomain,
    utmSource: input.utm.source,
    utmMedium: input.utm.medium,
    utmCampaign: input.utm.campaign,
    utmTerm: input.utm.term,
    utmContent: input.utm.content,
    clickIdParam: input.clickIdParam,
    browser: input.device.browser,
    os: input.device.os,
    deviceType: input.device.deviceType,
    screen: input.screen,
    language: input.language,
    country: input.country,
  } as MarketingSession;
  await model.insert(session);
  return session;
}
