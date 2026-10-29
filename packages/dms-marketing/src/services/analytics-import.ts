import { randomUUID } from "node:crypto";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  MarketingAnalyticsImport,
  MarketingImportResult,
} from "@antelopejs/interface-dms-marketing";
import { z } from "zod";
import { getConfig } from "@/config";
import { FunnelsModel, MarketingImportsModel, WebsitesModel } from "@/db";
import type { MarketingImport } from "@/db/tables/marketing_imports.table";
import type { Website } from "@/db/tables/websites.table";
import type { DeviceInfo } from "@/types";
import { isObject } from "@/utils/guards";
import {
  MAX_COLLECT_BATCH_SIZE,
  MAX_SCREEN_AND_LANGUAGE_CHARS,
  MAX_TRUSTED_CLIENT_CLOCK_SKEW_MS,
} from "@/types/constants";
import {
  ingestPreparedBatch,
  type IngestOutcome,
  type PreparedEvent,
  prepareEvents,
} from "./collect";
import {
  declaredTenant,
  describeIssue,
  instantOf,
  MarketingDeclarationError,
  requireDeclaredId,
} from "./declarations";
import { isAutomatedClient } from "./ingest-guard";
import { getVisitorHashSecret } from "./settings";
import { getUtcMidnight } from "./rollup-write";
import { parseDevice } from "./user-agent";
import { computeVisitorId } from "./visitor-id";

const OPERATION = "ImportAnalytics";

/**
 * How long the tracker holds events before it sends them: an imported batch
 * spans no more, so sessions are timed against the same clock as live ones.
 */
const TRACKER_FLUSH_INTERVAL_MS = 5000;
/** One call carries a bounded slice of history; split a larger one. */
const MAX_IMPORT_SESSIONS = 10_000;
const MAX_IMPORT_EVENTS_PER_SESSION = 1000;
const MAX_VISITOR_KEY_LENGTH = 200;
const MAX_USER_AGENT_LENGTH = 1000;
/** Visitors replayed side by side; one visitor's events stay in order. */
const IMPORT_CONCURRENCY = 4;
/** Imported visitors hash apart from live ones: never the same visitor id. */
const IMPORTED_VISITOR_PREFIX = "import:";
const PAGEVIEW_KIND = "pageview";
const EXPOSURE_KIND = "exposure";

const sessionSchema = z.object({
  visitor: z.string().min(1).max(MAX_VISITOR_KEY_LENGTH),
  userAgent: z.string().max(MAX_USER_AGENT_LENGTH).optional(),
  country: z
    .string()
    .regex(/^[A-Za-z]{2}$/)
    .transform((code) => code.toUpperCase())
    .optional(),
  screen: z.string().max(MAX_SCREEN_AND_LANGUAGE_CHARS).optional(),
  language: z.string().max(MAX_SCREEN_AND_LANGUAGE_CHARS).optional(),
  events: z.array(z.unknown()).max(MAX_IMPORT_EVENTS_PER_SESSION),
});

const batchSchema = z.object({
  websiteId: z.string().min(1),
  sessions: z.array(sessionSchema).max(MAX_IMPORT_SESSIONS),
});

type ImportSession = z.output<typeof sessionSchema>;

/** One accepted event of a visitor, with what its session says about them. */
interface VisitorEvent {
  event: PreparedEvent;
  at: number;
  device: DeviceInfo;
  country?: string;
}

interface ReplayCounts {
  sessions: number;
  events: number;
  dropped: number;
}

function refuse(id: string, reason: string): MarketingDeclarationError {
  return new MarketingDeclarationError(OPERATION, id, reason);
}

function importRowId(websiteId: string, importId: string): string {
  return `${websiteId}:${importId}`;
}

/** An import event in the tracker's own shape, for the collect schema. */
function asTrackedEvent(
  raw: unknown,
  session: ImportSession,
): Record<string, unknown> | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  const event = raw as Record<string, unknown>;
  const at = instantOf(event.at);
  if (at === undefined) {
    return undefined;
  }
  return {
    kind: event.kind,
    url: event.url,
    referrer: event.referrer,
    title: event.title,
    screen: session.screen,
    language: session.language,
    name: event.name,
    data: event.data,
    at: Math.round(at),
  };
}

/**
 * The keys an imported exposure may name: any split of the site that left
 * draft. Live collection only takes the running ones, but history is made of
 * splits that may have stopped since — their results are read over their
 * runs anyway, so an exposure outside them counts for nothing.
 */
async function startedExperimentKeys(
  tenantId: string,
  websiteId: string,
): Promise<Set<string>> {
  const funnels = await GetModel(FunnelsModel, tenantId).listByWebsite(
    websiteId,
  );
  return new Set(
    funnels
      .map((funnel) => funnel.experiment)
      .filter((experiment) => experiment && experiment.status !== "draft")
      .map((experiment) => experiment?.key ?? ""),
  );
}

/**
 * Every event that can be replayed, grouped by visitor and in time order;
 * the rest is counted as dropped: invalid as the collect endpoint judges it,
 * in the future, past the statistics retention, from a bot user agent, or
 * an exposure of a split that never started.
 */
function acceptedEventsByVisitor(
  websiteId: string,
  sessions: ImportSession[],
  experimentKeys: ReadonlySet<string>,
) {
  const now = Date.now();
  const oldest = now - getConfig().statisticsRetention;
  const newest = now + MAX_TRUSTED_CLIENT_CLOCK_SKEW_MS;
  const visitors = new Map<string, VisitorEvent[]>();
  let dropped = 0;
  for (const session of sessions) {
    if (session.userAgent && isAutomatedClient(session.userAgent)) {
      dropped += session.events.length;
      continue;
    }
    const device = parseDevice(session.userAgent);
    const tracked = session.events
      .map((raw) => asTrackedEvent(raw, session))
      .filter((event) => event !== undefined);
    const prepared = prepareEvents(websiteId, tracked).filter((event) => {
      const at = event.input.at ?? 0;
      return (
        at >= oldest &&
        at <= newest &&
        (event.input.kind !== EXPOSURE_KIND ||
          experimentKeys.has(event.input.name ?? ""))
      );
    });
    dropped += session.events.length - prepared.length;
    const own = visitors.get(session.visitor) ?? [];
    for (const event of prepared) {
      own.push({
        event,
        at: event.input.at ?? 0,
        device,
        country: session.country,
      });
    }
    visitors.set(session.visitor, own);
  }
  for (const events of visitors.values()) {
    events.sort((a, b) => a.at - b.at);
  }
  return { visitors, dropped };
}

/**
 * Cuts one visitor's history into the batches the tracker would have sent:
 * a page load starts one (each pageview is treated as a load, so a campaign
 * landing opens its own visit as it does live), and a batch holds at most
 * the tracker's flush interval and batch size, on one UTC day, from one
 * device.
 */
function trackerBatches(events: VisitorEvent[]): VisitorEvent[][] {
  const batches: VisitorEvent[][] = [];
  let current: VisitorEvent[] = [];
  for (const entry of events) {
    const first = current[0];
    const startsBatch =
      first === undefined ||
      entry.event.input.kind === PAGEVIEW_KIND ||
      current.length >= MAX_COLLECT_BATCH_SIZE ||
      entry.at - first.at > TRACKER_FLUSH_INTERVAL_MS ||
      getUtcMidnight(new Date(entry.at)) !==
        getUtcMidnight(new Date(first.at)) ||
      entry.device !== first.device ||
      entry.country !== first.country;
    if (startsBatch && current.length > 0) {
      batches.push(current);
      current = [];
    }
    current.push(entry);
  }
  if (current.length > 0) {
    batches.push(current);
  }
  return batches;
}

/**
 * Replays one visitor's batches through live ingestion, each on the clock
 * of its last event — the instant the tracker would have sent it.
 */
async function replayVisitor(
  website: Website,
  visitor: string,
  events: VisitorEvent[],
): Promise<ReplayCounts> {
  const counts: ReplayCounts = { sessions: 0, events: 0, dropped: 0 };
  for (const batch of trackerBatches(events)) {
    const first = batch[0]!;
    const last = batch[batch.length - 1]!;
    const outcome: IngestOutcome | undefined = await ingestPreparedBatch(
      website,
      batch.map((entry) => entry.event),
      {
        visitorId: computeVisitorId(
          getVisitorHashSecret(),
          website._id,
          IMPORTED_VISITOR_PREFIX + visitor,
          "",
          new Date(first.at),
        ),
        now: new Date(last.at),
        device: first.device,
        country: first.country,
        trustTimestamps: true,
      },
    );
    if (!outcome) {
      counts.dropped += batch.length;
      continue;
    }
    counts.events += outcome.accepted;
    counts.sessions += outcome.isNewSession ? 1 : 0;
    await outcome.rollup;
  }
  return counts;
}

async function replayAll(
  website: Website,
  visitors: Map<string, VisitorEvent[]>,
): Promise<ReplayCounts> {
  const queue = [...visitors.entries()];
  const total: ReplayCounts = { sessions: 0, events: 0, dropped: 0 };
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const counts = await replayVisitor(website, next[0], next[1]);
      total.sessions += counts.sessions;
      total.events += counts.events;
      total.dropped += counts.dropped;
    }
  };
  await Promise.all(Array.from({ length: IMPORT_CONCURRENCY }, worker));
  return total;
}

async function requireWebsite(
  importId: string,
  websiteId: string,
  tenantId: string,
): Promise<Website> {
  const website = await GetModel(WebsitesModel).get(websiteId);
  if (!website || website.tenantId !== tenantId) {
    throw refuse(
      importId,
      `no website "${websiteId}" in the tenant "${tenantId}"`,
    );
  }
  return website;
}

/** What a call answers for an import id it finds already claimed. */
const CLAIMED_STATUS = {
  running: "in_progress",
  done: "skipped",
  failed: "failed",
} as const satisfies Record<MarketingImport["status"], string>;

function claimed(row: MarketingImport): MarketingImportResult {
  return {
    importId: row.importId,
    status: CLAIMED_STATUS[row.status],
    sessions: row.sessions,
    events: row.events,
    dropped: row.dropped,
  };
}

/**
 * ImportAnalytics: claims the import id for the website, then replays the
 * history. Claimed first, so a second call — another instance booting the
 * same project, the next boot — is not counted twice: it answers
 * `in_progress` while the first is still replaying, `skipped` once it is
 * done, `failed` if it failed (the claim stays, for the same reason).
 *
 * The events are prepared before the claim, so a validation failure has written
 * no analytics. The claim is a row under the empty import id, which no caller
 * can declare, so it cannot collide with a caller's id; its plain insert gives
 * one writer per website across instances. An uncertain claim insert is neither
 * retried nor released. Once the replay starts, an uncertain write or a crash
 * retains the website claim, and it is never released in a `finally`: other
 * replay workers may still be writing.
 */
export async function importAnalytics(
  batch: MarketingAnalyticsImport,
): Promise<MarketingImportResult> {
  const importId = requireDeclaredId(OPERATION, batch?.importId);
  const parsed = batchSchema.safeParse(batch);
  if (!parsed.success) {
    throw refuse(importId, describeIssue(parsed.error));
  }
  const { websiteId, sessions } = parsed.data;
  const tenantId = declaredTenant(OPERATION, importId, batch.tenantId);
  const website = await requireWebsite(importId, websiteId, tenantId);
  const imports = GetModel(MarketingImportsModel, tenantId);
  const rowId = importRowId(websiteId, importId);
  const applied = await imports.get(rowId);
  if (applied) {
    return claimed(applied);
  }
  const { visitors, dropped } = acceptedEventsByVisitor(
    websiteId,
    sessions,
    await startedExperimentKeys(tenantId, websiteId),
  );
  let earliest = Number.POSITIVE_INFINITY;
  let latest = 0;
  for (const events of visitors.values()) {
    for (const event of events) {
      earliest = Math.min(earliest, event.at);
      latest = Math.max(latest, event.at);
    }
  }
  const row = {
    _id: rowId,
    websiteId,
    importId,
    status: "running" as const,
    sessions: 0,
    events: 0,
    dropped: 0,
    startedAt: new Date(),
  };
  const claimId = importRowId(websiteId, "");
  const claimToken = randomUUID();
  try {
    await imports.insert({ ...row, _id: claimId, claimToken });
  } catch (err) {
    const raced = await imports.get(rowId);
    if (raced) {
      return claimed(raced);
    }
    const owner = await imports.get(claimId);
    if (owner && owner.claimToken !== claimToken) {
      if (owner.importId === importId) {
        return claimed(owner);
      }
      throw refuse(
        importId,
        "another import owns this website; retry after it completes (an interrupted import requires reconciliation)",
      );
    }
    throw err;
  }

  let importedThrough = 0;
  try {
    const raced = await imports.get(rowId);
    if (raced) {
      await imports.releaseClaim(claimId, claimToken);
      return claimed(raced);
    }
    for (const previous of await imports.listByWebsite(websiteId)) {
      if (previous._id === claimId) {
        continue;
      }
      if (previous.status !== "done" || previous.importedThrough == null) {
        throw refuse(
          importId,
          "previous import needs reconciliation before more history can be imported",
        );
      }
      importedThrough = Math.max(
        importedThrough,
        previous.importedThrough.getTime(),
      );
    }
    if (earliest < importedThrough) {
      throw refuse(
        importId,
        "imports must use chronological, non-overlapping windows for the entire website",
      );
    }
  } catch (err) {
    await imports.releaseClaim(claimId, claimToken);
    throw err;
  }

  try {
    await imports.insert(row);
    const counts = await replayAll(website, visitors);
    counts.dropped += dropped;
    await imports.update(rowId, {
      status: "done",
      ...counts,
      importedThrough: new Date(Math.max(importedThrough, latest)),
      finishedAt: new Date(),
    });
    await imports.releaseClaim(claimId, claimToken);
    return { importId, status: "imported", ...counts };
  } catch (err) {
    await imports
      .update(rowId, { status: "failed", dropped, finishedAt: new Date() })
      .catch(() => {});
    throw refuse(
      importId,
      `failed part-way, and will not be replayed under this id: ${describeIssue(err)}`,
    );
  }
}
