import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { getConfig } from "@/config";
import {
  MarketingEventsModel,
  MarketingSessionsModel,
  WebsiteStatisticsModel,
} from "@/db";
import type { MarketingEvent } from "@/db/tables/marketing_events.table";
import type { MarketingSession } from "@/db/tables/marketing_sessions.table";
import type { Website } from "@/db/tables/websites.table";
import {
  byDimension,
  type DeviceInfo,
  type MarketingStatsDelta,
  type TopDimension,
  type TrackedEventInput,
  trackedEventSchema,
} from "@/types";
import {
  MAX_TRUSTED_CLIENT_CLOCK_SKEW_MS,
  MS_PER_MINUTE,
} from "@/types/constants";
import { campaignKey, resolveChannel } from "./acquisition";
import { BoundedCache } from "./bounded-cache";
import { runningExperimentKeys } from "./experiment-definitions";
import { lookupCountry } from "./geoip";
import { noteCollected } from "./realtime";
import { addDailyMarketingStats, getUtcMidnight } from "./rollup-write";
import { resolveSession, type SessionResolution } from "./sessionize";
import { getVisitorHashSecret } from "./settings";
import {
  extractReferrerDomain,
  type ParsedTrackedUrl,
  parseTrackedUrl,
  toBareHostname,
} from "./url";
import { parseDevice } from "./user-agent";
import { computeVisitorId } from "./visitor-id";

export interface CollectRequestMeta {
  ip: string;
  userAgent: string;
}

export interface CollectOutcome {
  accepted: number;
  dropped: number;
}

const EXPOSURE_KIND = "exposure";
const PAGEVIEW_KIND = "pageview";

export interface PreparedEvent {
  input: TrackedEventInput;
  url: ParsedTrackedUrl;
}

/**
 * Who sent a batch and when, as ingestion sees it. Live collection derives
 * it from the request; an import (services/analytics-import) states it.
 */
export interface IngestIdentity {
  visitorId: string;
  /** The server clock of the batch: what sessions are timed against. */
  now: Date;
  device: DeviceInfo;
  country?: string;
  /**
   * The events' own timestamps are the truth, however far from `now`: an
   * imported history. Live beacons only keep a client clock within
   * MAX_TRUSTED_CLIENT_CLOCK_SKEW_MS of the server's.
   */
  trustTimestamps?: boolean;
}

/** What one ingested batch did; `rollup` settles once the day row is written. */
export interface IngestOutcome {
  accepted: number;
  isNewSession: boolean;
  rollup: Promise<void>;
}

interface BatchContext {
  website: Website;
  identity: IngestIdentity;
  now: Date;
  ownHostnames: ReadonlySet<string>;
}

/**
 * Ingestion pipeline for one collect batch: derive the anonymous visitor id,
 * resolve/extend the session, persist thin events, then push the daily
 * rollup increment fire-and-forget — a rollup failure must not lose raw
 * events.
 */
export async function processCollectBatch(
  website: Website,
  events: unknown[],
  meta: CollectRequestMeta,
): Promise<CollectOutcome> {
  const now = new Date();
  const prepared = await acceptExposures(
    website,
    prepareEvents(website._id, events),
  );
  const refused = { accepted: 0, dropped: events.length };
  if (prepared.length === 0) {
    return refused;
  }
  const outcome = await ingestPreparedBatch(website, prepared, {
    visitorId: computeVisitorId(
      getVisitorHashSecret(),
      website._id,
      meta.ip,
      meta.userAgent,
      now,
    ),
    now,
    device: parseDevice(meta.userAgent),
    country: lookupCountry(meta.ip),
  });
  if (!outcome) {
    return refused;
  }
  void outcome.rollup.catch((err) => {
    Logging.Error("[dms-marketing] daily rollup write failed:", err);
  });
  return {
    accepted: outcome.accepted,
    dropped: events.length - outcome.accepted,
  };
}

/**
 * The part of collection after the request: session, raw events, session
 * counters, daily rollup — shared by live beacons and imported history, so
 * both produce the same rows. Undefined when the batch may not open a
 * session and finds none to join.
 */
export async function ingestPreparedBatch(
  website: Website,
  prepared: PreparedEvent[],
  identity: IngestIdentity,
): Promise<IngestOutcome | undefined> {
  const context: BatchContext = {
    website,
    identity,
    now: identity.now,
    ownHostnames: collectOwnHostnames(website, prepared),
  };

  const resolution = await openSession(context, prepared);
  if (!resolution) {
    return undefined;
  }
  const docs = prepared.map((event) =>
    buildEventDoc(context, resolution.session, event),
  );

  await GetModel(MarketingEventsModel, website.tenantId).insertMany(docs);
  const previous = snapshotSession(resolution.session);
  await touchSession(context, resolution, docs);

  const rollup = recordRollup(context, resolution, docs, previous);
  // Once the day's counters hold the batch, or failed to: the raw events
  // the heatmaps and funnels read are stored either way.
  const notify = () => noteCollected(docs.length);
  void rollup.then(notify, notify);
  return {
    accepted: docs.length,
    isNewSession: resolution.isNewSession,
    rollup,
  };
}

/** One warning per website per minute: enough to notice a page sending a
 * malformed event on every load, never a log flood. */
const invalidEventLogGate = new BoundedCache<true>(MS_PER_MINUTE);

/**
 * Each event stands or falls alone: an over-long name or a malformed click
 * drops that event (counted in `dropped`), never the pageview batched with it.
 */
export function prepareEvents(
  websiteId: string,
  events: unknown[],
): PreparedEvent[] {
  const prepared: PreparedEvent[] = [];
  for (const event of events) {
    const parsed = trackedEventSchema.safeParse(event);
    if (parsed.success) {
      const input = parsed.data;
      prepared.push({ input, url: parseTrackedUrl(input.url) });
    } else {
      warnInvalidEvent(websiteId, parsed.error.issues[0]);
    }
  }
  return prepared;
}

function warnInvalidEvent(
  websiteId: string,
  issue: { path: (string | number)[]; message: string } | undefined,
): void {
  if (invalidEventLogGate.get(websiteId)) {
    return;
  }
  invalidEventLogGate.set(websiteId, true);
  Logging.Warn(
    `[dms-marketing] collect: dropping invalid events for website '${websiteId}' (${issue?.path.join(".") ?? "event"}: ${issue?.message ?? "invalid"}).`,
  );
}

/**
 * Only running splits may be exposed into. The tracker stops asking within
 * the definitions TTL, but nothing else does: `dmsMarketing.exposure()` is a
 * public escape hatch, pages loaded before the stop keep their assignment
 * until they reload, and collect is an open endpoint — a stopped experiment
 * would otherwise keep growing an arm. The definitions read is cached and
 * only reached when the batch actually carries an exposure.
 */
async function acceptExposures(
  website: Website,
  events: PreparedEvent[],
): Promise<PreparedEvent[]> {
  if (!events.some((event) => event.input.kind === EXPOSURE_KIND)) {
    return events;
  }
  const running = await runningExperimentKeys(website._id);
  return events.filter(
    (event) =>
      event.input.kind !== EXPOSURE_KIND ||
      // The schema refuses a nameless exposure; no key is empty.
      running.has(event.input.name ?? ""),
  );
}

/**
 * Every host this batch counts as "the site itself": the domain configured on
 * the website plus the hostnames the tracker actually reported (staging,
 * preview and localhost deployments never match the configured one).
 */
function collectOwnHostnames(
  website: Website,
  events: PreparedEvent[],
): Set<string> {
  const candidates = [website.domain, ...events.map((e) => e.url.hostname)];
  return new Set(
    candidates.map(toBareHostname).filter((bare) => bare !== undefined),
  );
}

/**
 * Only a pageview opens a session, and it is the batch's first pageview that
 * describes the visit (entry page, campaign). A batch without one — a click
 * or a scroll depth sent after half an hour on the same page — joins the
 * visitor's last session, expired or not, and is dropped when there is none.
 * Joining an expired session records the events without reopening it.
 */
async function openSession(
  context: BatchContext,
  prepared: PreparedEvent[],
): Promise<SessionResolution | undefined> {
  const pageview = prepared.find((event) => event.input.kind === PAGEVIEW_KIND);
  const first = pageview ?? prepared[0];
  return resolveSession(
    GetModel(MarketingSessionsModel, context.website.tenantId),
    {
      websiteId: context.website._id,
      visitorId: context.identity.visitorId,
      now: context.now,
      startedAt: eventTimestamp(context, first.input),
      opensSession: pageview !== undefined,
      sessionIdleTimeoutMs: getConfig().sessionIdleTimeout,
      entryUrl: first.url.path,
      referrerDomain: extractReferrerDomain(
        first.input.referrer,
        context.ownHostnames,
      ),
      utm: first.url.utm,
      clickIdParam: first.url.clickIdParam,
      device: context.identity.device,
      screen: first.input.screen,
      language: first.input.language,
      country: context.identity.country,
      bypassCache: context.identity.trustTimestamps,
    },
  );
}

function eventTimestamp(context: BatchContext, event: TrackedEventInput): Date {
  const { now } = context;
  if (event.at === undefined) {
    return now;
  }
  if (context.identity.trustTimestamps) {
    return new Date(event.at);
  }
  const skew = Math.abs(now.getTime() - event.at);
  return skew <= MAX_TRUSTED_CLIENT_CLOCK_SKEW_MS ? new Date(event.at) : now;
}

function buildEventDoc(
  context: BatchContext,
  session: MarketingSession,
  event: PreparedEvent,
): MarketingEvent {
  const timestamp = eventTimestamp(context, event.input);
  return {
    timestamp,
    day: getUtcMidnight(timestamp),
    websiteId: context.website._id,
    kind: event.input.kind,
    sessionId: session._id,
    visitorId: context.identity.visitorId,
    url: event.url.path,
    referrerDomain: extractReferrerDomain(
      event.input.referrer,
      context.ownHostnames,
    ),
    name: event.input.name,
    data: event.input.data,
  } as MarketingEvent;
}

/**
 * The bounce, duration and exit-page contributions of a batch are all
 * transitions from the state the previous batch left: what `touchSession`
 * is about to overwrite is exactly the baseline they diff against. On a
 * session this batch created, the snapshot equals the fresh session and
 * every transition starts from zero.
 */
interface SessionSnapshot {
  lastSeenAt: Date;
  pageviewsCount: number;
  exitUrl: string;
}

function snapshotSession(session: MarketingSession): SessionSnapshot {
  return {
    lastSeenAt: session.lastSeenAt,
    pageviewsCount: session.pageviewsCount,
    exitUrl: session.exitUrl,
  };
}

/**
 * An expired session joined by a batch without a pageview only counts the
 * events: advancing `lastSeenAt` would let the next pageview join it instead
 * of opening a new session, and such a batch never moves the exit page.
 */
async function touchSession(
  context: BatchContext,
  resolution: SessionResolution,
  docs: MarketingEvent[],
): Promise<void> {
  const { session, extendsSession } = resolution;
  const pageviews = docs.filter((doc) => doc.kind === "pageview");
  const lastPageview = extendsSession
    ? pageviews[pageviews.length - 1]
    : undefined;
  await GetModel(
    MarketingSessionsModel,
    context.website.tenantId,
  ).recordActivity(session._id, {
    pageviews: pageviews.length,
    events: docs.length,
    lastSeenAt: extendsSession ? context.now : undefined,
    exitUrl: lastPageview?.url,
  });
  session.pageviewsCount += pageviews.length;
  session.eventsCount += docs.length;
  if (extendsSession) {
    session.lastSeenAt = context.now;
  }
  if (lastPageview) {
    session.exitUrl = lastPageview.url;
  }
}

interface RollupBatch {
  pageviews: MarketingEvent[];
  customEvents: MarketingEvent[];
  session: MarketingSession;
  previous: SessionSnapshot;
  isNewSession: boolean;
  isNewVisitor: boolean;
}

type TopSource = (batch: RollupBatch) => (string | undefined)[];

/**
 * Acquisition context belongs to the visit, not to the beacon: counting it on
 * every batch would multiply one referrer by the number of batches the visit
 * sends, so these dimensions only fire on the batch that opened the session.
 */
function onNewSession(
  pick: (session: MarketingSession) => string | undefined,
): TopSource {
  return (batch) => (batch.isNewSession ? [pick(batch.session)] : []);
}

/**
 * The exit page is a moving target: every batch ending on a different page
 * takes the session's one exit count from the page holding it. `touchSession`
 * already ran, so `session.exitUrl` is this batch's exit and the snapshot
 * holds the one it replaces.
 */
function exitMoved(batch: RollupBatch): boolean {
  return (
    !batch.isNewSession && batch.session.exitUrl !== batch.previous.exitUrl
  );
}

const TOP_SOURCES: Record<TopDimension, TopSource> = {
  topPages: (batch) => batch.pageviews.map((doc) => doc.url),
  topEntryPages: onNewSession((session) => session.entryUrl),
  topExitPages: (batch) =>
    batch.isNewSession || exitMoved(batch) ? [batch.session.exitUrl] : [],
  topReferrers: onNewSession((session) => session.referrerDomain),
  topUtmSources: onNewSession((session) => session.utmSource),
  topUtmMediums: onNewSession((session) => session.utmMedium),
  topUtmCampaigns: onNewSession((session) => session.utmCampaign),
  topUtmTerms: onNewSession((session) => session.utmTerm),
  topUtmContents: onNewSession((session) => session.utmContent),
  topCampaigns: onNewSession((session) => campaignKey(session)),
  topChannels: onNewSession((session) =>
    resolveChannel(
      session.referrerDomain,
      session.utmMedium,
      session.clickIdParam,
    ),
  ),
  topDevices: onNewSession((session) => session.deviceType),
  topBrowsers: onNewSession((session) => session.browser),
  topCountries: onNewSession((session) => session.country),
  topEvents: (batch) => batch.customEvents.map((doc) => doc.name),
  topLanguages: onNewSession((session) => session.language),
};

const TOP_DROP_SOURCES: Partial<Record<TopDimension, TopSource>> = {
  topExitPages: (batch) => (exitMoved(batch) ? [batch.previous.exitUrl] : []),
};

/** Empty as well as absent: a blank name would take a slot in a top-N map. */
function collectTops(batch: RollupBatch): Record<TopDimension, string[]> {
  return byDimension<string[]>((dimension: TopDimension) =>
    TOP_SOURCES[dimension](batch).filter((value): value is string =>
      Boolean(value),
    ),
  );
}

function collectDrops(
  batch: RollupBatch,
): Partial<Record<TopDimension, string[]>> {
  return Object.fromEntries(
    Object.entries(TOP_DROP_SOURCES).map(([dimension, source]) => [
      dimension,
      source(batch).filter((value): value is string => Boolean(value)),
    ]),
  );
}

/**
 * Bounce = session sitting at exactly one pageview. Counted as a transition
 * (is bounced minus was bounced) so the batch bringing the second pageview
 * takes back the bounce the first one counted; day sums stay the number of
 * sessions currently bounced.
 */
function bounceDelta(batch: RollupBatch): number {
  const wasBounced = batch.previous.pageviewsCount === 1;
  const isBounced = batch.session.pageviewsCount === 1;
  return Number(isBounced) - Number(wasBounced);
}

/**
 * How much this batch stretched the session: the gap since the previous
 * batch — on a fresh session, since its first event — summed per day, total
 * observed session time. Clamped below because a session resumed on another
 * instance can carry a `lastSeenAt` from a clock slightly ahead of ours; a
 * gap past the idle timeout (an event joining an expired session) is idle
 * time, not visit time.
 */
function durationDelta(batch: RollupBatch, now: Date): number {
  const gap = now.getTime() - batch.previous.lastSeenAt.getTime();
  return gap < getConfig().sessionIdleTimeout ? Math.max(0, gap) : 0;
}

function recordRollup(
  context: BatchContext,
  resolution: SessionResolution,
  docs: MarketingEvent[],
  previous: SessionSnapshot,
): Promise<void> {
  const batch: RollupBatch = {
    pageviews: docs.filter((doc) => doc.kind === "pageview"),
    customEvents: docs.filter((doc) => doc.kind === "custom"),
    session: resolution.session,
    previous,
    isNewSession: resolution.isNewSession,
    isNewVisitor: resolution.isNewVisitor,
  };
  const delta: MarketingStatsDelta = {
    pageviews: batch.pageviews.length,
    sessions: resolution.isNewSession ? 1 : 0,
    newVisitors: resolution.isNewVisitor ? 1 : 0,
    customEvents: batch.customEvents.length,
    bouncedSessions: bounceDelta(batch),
    sessionDurationMs: durationDelta(batch, context.now),
    tops: collectTops(batch),
    drops: collectDrops(batch),
  };
  // The events' own clock, as their `day`: the batch's first event dates it,
  // the one a new session starts at. Across midnight, an event of 23:59 kept
  // by its timestamp would otherwise be counted in the next day's row.
  return addDailyMarketingStats(
    GetModel(WebsiteStatisticsModel, context.website.tenantId),
    context.website._id,
    getUtcMidnight(docs[0]?.timestamp ?? context.now),
    delta,
  );
}
