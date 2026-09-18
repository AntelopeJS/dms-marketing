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
  type MarketingStatsDelta,
  type TopDimension,
  type TrackedEventInput,
} from "@/types";
import {
  MAX_EVENT_DATA_BYTES,
  MAX_TRUSTED_CLIENT_CLOCK_SKEW_MS,
} from "@/types/constants";
import { campaignKey, resolveChannel } from "./acquisition";
import { runningExperimentKeys } from "./experiment-definitions";
import { lookupCountry } from "./geoip";
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
const NAME_REQUIRED_KINDS = new Set<string>(["custom", EXPOSURE_KIND]);

interface PreparedEvent {
  input: TrackedEventInput;
  url: ParsedTrackedUrl;
}

interface BatchContext {
  website: Website;
  visitorId: string;
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
  events: TrackedEventInput[],
  meta: CollectRequestMeta,
): Promise<CollectOutcome> {
  const now = new Date();
  const prepared = await acceptExposures(website, prepareEvents(events));
  const dropped = events.length - prepared.length;
  if (prepared.length === 0) {
    return { accepted: 0, dropped };
  }

  const context: BatchContext = {
    website,
    visitorId: computeVisitorId(
      getVisitorHashSecret(),
      website._id,
      meta.ip,
      meta.userAgent,
      now,
    ),
    now,
    ownHostnames: collectOwnHostnames(website, prepared),
  };

  const resolution = await openSession(context, prepared[0], meta);
  const docs = prepared.map((event) =>
    buildEventDoc(context, resolution.session, event),
  );

  await GetModel(MarketingEventsModel, website.tenantId).insertMany(docs);
  const previous = snapshotSession(resolution.session);
  await touchSession(context, resolution.session, docs);

  recordRollup(context, resolution, docs, previous);
  return { accepted: docs.length, dropped };
}

function prepareEvents(events: TrackedEventInput[]): PreparedEvent[] {
  return events
    .filter(isAcceptable)
    .map((input) => ({ input, url: parseTrackedUrl(input.url) }));
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
      // `isAcceptable` already dropped the nameless ones; no key is empty.
      running.has(event.input.name ?? ""),
  );
}

function isAcceptable(event: TrackedEventInput): boolean {
  if (NAME_REQUIRED_KINDS.has(event.kind) && !event.name) {
    return false;
  }
  return (
    !event.data || JSON.stringify(event.data).length <= MAX_EVENT_DATA_BYTES
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

async function openSession(
  context: BatchContext,
  first: PreparedEvent,
  meta: CollectRequestMeta,
): Promise<SessionResolution> {
  return resolveSession(
    GetModel(MarketingSessionsModel, context.website.tenantId),
    {
      websiteId: context.website._id,
      visitorId: context.visitorId,
      now: context.now,
      sessionIdleTimeoutMs: getConfig().sessionIdleTimeout,
      entryUrl: first.url.path,
      referrerDomain: extractReferrerDomain(
        first.input.referrer,
        context.ownHostnames,
      ),
      utm: first.url.utm,
      clickIdParam: first.url.clickIdParam,
      device: parseDevice(meta.userAgent),
      screen: first.input.screen,
      language: first.input.language,
      country: lookupCountry(meta.ip),
    },
  );
}

function eventTimestamp(event: TrackedEventInput, now: Date): Date {
  if (event.at === undefined) {
    return now;
  }
  const skew = Math.abs(now.getTime() - event.at);
  return skew <= MAX_TRUSTED_CLIENT_CLOCK_SKEW_MS ? new Date(event.at) : now;
}

function buildEventDoc(
  context: BatchContext,
  session: MarketingSession,
  event: PreparedEvent,
): MarketingEvent {
  const timestamp = eventTimestamp(event.input, context.now);
  return {
    timestamp,
    day: getUtcMidnight(timestamp),
    websiteId: context.website._id,
    kind: event.input.kind,
    sessionId: session._id,
    visitorId: context.visitorId,
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

async function touchSession(
  context: BatchContext,
  session: MarketingSession,
  docs: MarketingEvent[],
): Promise<void> {
  const pageviews = docs.filter((doc) => doc.kind === "pageview");
  const lastPageview = pageviews[pageviews.length - 1];
  await GetModel(
    MarketingSessionsModel,
    context.website.tenantId,
  ).recordActivity(session._id, {
    pageviews: pageviews.length,
    events: docs.length,
    lastSeenAt: context.now,
    exitUrl: lastPageview?.url,
  });
  session.pageviewsCount += pageviews.length;
  session.eventsCount += docs.length;
  session.lastSeenAt = context.now;
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
 * How much this batch stretched the session: zero on a fresh session, else
 * the gap since the previous batch — summed per day, total observed session
 * time. Clamped because a session resumed on another instance can carry a
 * `lastSeenAt` from a clock slightly ahead of ours.
 */
function durationDelta(batch: RollupBatch, now: Date): number {
  return Math.max(0, now.getTime() - batch.previous.lastSeenAt.getTime());
}

function recordRollup(
  context: BatchContext,
  resolution: SessionResolution,
  docs: MarketingEvent[],
  previous: SessionSnapshot,
): void {
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
  void addDailyMarketingStats(
    GetModel(WebsiteStatisticsModel, context.website.tenantId),
    context.website._id,
    getUtcMidnight(context.now),
    delta,
  ).catch((err) => {
    Logging.Error("[dms-marketing] daily rollup write failed:", err);
  });
}
