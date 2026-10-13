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
  /** First event of the batch: when a session it opens started. */
  startedAt: Date;
  /** False for a batch without a pageview: it joins the visitor's last
   * session, expired or not, and never opens one (see `extendsSession`). */
  opensSession: boolean;
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
  /** False when a batch without a pageview joined a session already past
   * the idle timeout: its events are kept, but the session must not move its
   * `lastSeenAt` — that would revive it for the next pageview. */
  extendsSession: boolean;
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

function isFresh(
  session: MarketingSession,
  now: Date,
  idleTimeoutMs: number,
): boolean {
  return now.getTime() - session.lastSeenAt.getTime() < idleTimeoutMs;
}

const ACQUISITION_FIELDS = [
  ["utmSource", "source"],
  ["utmMedium", "medium"],
  ["utmCampaign", "campaign"],
  ["utmTerm", "term"],
  ["utmContent", "content"],
] as const;

/**
 * A campaign landing (UTM parameters or an ad click id) that differs from the
 * one the session holds starts a visit of its own, as in Google Analytics:
 * the session's acquisition is fixed at its start, so joining would lose the
 * campaign entirely. A landing without campaign parameters — an internal
 * link, a reload of a clean URL — never splits a session.
 */
function startsNewCampaign(
  session: MarketingSession,
  input: SessionInput,
): boolean {
  const hasCampaign =
    input.clickIdParam !== undefined ||
    ACQUISITION_FIELDS.some(([, field]) => input.utm[field] !== undefined);
  // Rows read back carry null where the insert had undefined.
  return (
    hasCampaign &&
    ((session.clickIdParam ?? undefined) !== input.clickIdParam ||
      ACQUISITION_FIELDS.some(
        ([column, field]) =>
          (session[column] ?? undefined) !== input.utm[field],
      ))
  );
}

function joins(session: MarketingSession, input: SessionInput): boolean {
  if (!input.opensSession) {
    return true;
  }
  return (
    isFresh(session, input.now, input.sessionIdleTimeoutMs) &&
    !startsNewCampaign(session, input)
  );
}

function joined(
  session: MarketingSession,
  input: SessionInput,
): SessionResolution {
  return {
    session,
    isNewSession: false,
    isNewVisitor: false,
    extendsSession: isFresh(session, input.now, input.sessionIdleTimeoutMs),
  };
}

function cachedResolution(
  key: string,
  input: SessionInput,
): SessionResolution | undefined {
  const cached = sessionCache.get(key);
  if (!cached || !joins(cached, input)) {
    return undefined;
  }
  return joined(cached, input);
}

/** Undefined only for a batch that may not open a session and finds none. */
export async function resolveSession(
  model: MarketingSessionsModel,
  input: SessionInput,
): Promise<SessionResolution | undefined> {
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
): Promise<SessionResolution | undefined> {
  const cached = cachedResolution(key, input);
  if (cached) {
    return cached;
  }

  const latest = await model.findLatestForVisitor(
    input.websiteId,
    input.visitorId,
  );
  if (latest && joins(latest, input)) {
    cacheSession(key, latest);
    return joined(latest, input);
  }
  if (!input.opensSession) {
    return undefined;
  }

  const session = await createSession(model, input, latest === undefined);
  cacheSession(key, session);
  return {
    session,
    isNewSession: true,
    isNewVisitor: latest === undefined,
    extendsSession: true,
  };
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
    startedAt: input.startedAt,
    lastSeenAt: input.startedAt,
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

/**
 * The visitor's session still open on `now`, or undefined: what a snapshot
 * upload checks its page against. Cache first, then the database.
 */
export async function findOpenSession(
  model: MarketingSessionsModel,
  websiteId: string,
  visitorId: string,
  now: Date,
  idleTimeoutMs: number,
): Promise<MarketingSession | undefined> {
  const session =
    sessionCache.get(cacheKey(websiteId, visitorId)) ??
    (await model.findLatestForVisitor(websiteId, visitorId));
  return session && isFresh(session, now, idleTimeoutMs) ? session : undefined;
}
