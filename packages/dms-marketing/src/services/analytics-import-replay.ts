import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  MarketingEventsModel,
  MarketingSessionsModel,
  WebsiteStatisticsModel,
} from "@/db";
import type { Website } from "@/db/tables/websites.table";
import type { AppliedImport } from "@/db/tables/website_statistics.table";
import type { DeviceInfo, MarketingStatsDelta } from "@/types";
import { MAX_COLLECT_BATCH_SIZE } from "@/types/constants";
import type { ImportClaim } from "./analytics-import-claim";
import {
  ingestPreparedBatch,
  type IngestIdentity,
  type IngestOutcome,
  type PreparedEvent,
} from "./collect";
import { isModulesStopping } from "./modules-stopping";
import { commitImportedDay, getUtcMidnight } from "./rollup-write";
import { getVisitorHashSecret } from "./settings";
import { computeVisitorId } from "./visitor-id";

/**
 * How long the tracker holds events before it sends them: an imported batch
 * spans no more, so sessions are timed against the same clock as live ones.
 */
const TRACKER_FLUSH_INTERVAL_MS = 5000;
/** Visitors replayed side by side; one visitor's events stay in order. */
const IMPORT_CONCURRENCY = 4;
/** Imported visitors hash apart from live ones: never the same visitor id. */
const IMPORTED_VISITOR_PREFIX = "import:";
const PAGEVIEW_KIND = "pageview";

/** One accepted event of a visitor, with what its session says about them. */
export interface VisitorEvent {
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
 * Replays one visitor's batches of a day through live ingestion, each on the
 * clock of its last event — the instant the tracker would have sent it.
 */
async function replayVisitor(
  website: Website,
  visitor: string,
  batches: VisitorEvent[][],
  imported: NonNullable<IngestIdentity["imported"]>,
): Promise<ReplayCounts> {
  const counts: ReplayCounts = { sessions: 0, events: 0, dropped: 0 };
  for (const batch of batches) {
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
        imported,
      },
    );
    if (!outcome) {
      counts.dropped += batch.length;
      continue;
    }
    counts.events += outcome.accepted;
    counts.sessions += outcome.isNewSession ? 1 : 0;
  }
  return counts;
}

/** Each UTC day's batches, by visitor: the unit an import commits. */
function batchesByDay(
  visitors: Map<string, VisitorEvent[]>,
): Map<number, Map<string, VisitorEvent[][]>> {
  const days = new Map<number, Map<string, VisitorEvent[][]>>();
  for (const [visitor, events] of visitors) {
    for (const batch of trackerBatches(events)) {
      const day = getUtcMidnight(new Date(batch[0]!.at));
      const ofDay = days.get(day) ?? new Map<string, VisitorEvent[][]>();
      ofDay.set(visitor, [...(ofDay.get(visitor) ?? []), batch]);
      days.set(day, ofDay);
    }
  }
  return days;
}

/**
 * Replays one day and holds its rollup. Every worker has stopped by the time
 * this settles, so a failure leaves nothing still writing.
 */
async function replayDay(
  website: Website,
  importId: string,
  visitors: Map<string, VisitorEvent[][]>,
  claim: ImportClaim,
): Promise<{ deltas: MarketingStatsDelta[]; counts: ReplayCounts }> {
  const deltas: MarketingStatsDelta[] = [];
  const imported = {
    importId,
    holdRollup: (delta: MarketingStatsDelta) => deltas.push(delta),
  };
  const queue = [...visitors.entries()];
  const counts: ReplayCounts = { sessions: 0, events: 0, dropped: 0 };
  const worker = async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      if (!claim.isHeld()) {
        throw new Error("another instance took the website claim over");
      }
      if (isModulesStopping()) {
        throw new Error("the modules are stopping");
      }
      try {
        const visitor = await replayVisitor(
          website,
          next[0],
          next[1],
          imported,
        );
        addCounts(counts, visitor);
      } catch (error) {
        queue.length = 0;
        throw error;
      }
    }
  };
  const settled = await Promise.allSettled(
    Array.from({ length: IMPORT_CONCURRENCY }, worker),
  );
  for (const result of settled) {
    if (result.status === "rejected") throw result.reason;
  }
  return { deltas, counts };
}

function addCounts(total: ReplayCounts, counts: ReplayCounts): void {
  total.sessions += counts.sessions;
  total.events += counts.events;
  total.dropped += counts.dropped;
}

/**
 * Takes back what a stopped attempt wrote on the days its ledger does not name.
 * Their rollups were only held in that attempt's memory, so the raw rows are all
 * there is to undo. A visit that crossed into such a day keeps its session,
 * recounted from the events that stay. Each write is derived from the rows that
 * exist, so repeating this after another stop converges.
 */
async function discardUncommitted(
  website: Website,
  importId: string,
  committed: ReadonlySet<number>,
): Promise<void> {
  const events = GetModel(MarketingEventsModel, website.tenantId);
  const sessions = GetModel(MarketingSessionsModel, website.tenantId);
  const discarded = (await events.listImported(website._id, importId)).filter(
    (event) => !committed.has(event.day),
  );
  const opened = (await sessions.listImported(website._id, importId))
    .filter(
      (session) => !committed.has(getUtcMidnight(new Date(session.startedAt))),
    )
    .map((session) => session._id);
  const crossing = new Set(discarded.map((event) => event.sessionId));
  for (const sessionId of opened) crossing.delete(sessionId);
  const discardedDays = new Set(discarded.map((event) => event.day));
  for (const sessionId of crossing) {
    const kept = (await events.listBySession(website._id, sessionId)).filter(
      (event) => !discardedDays.has(event.day),
    );
    await sessions.restoreActivity(sessionId, kept);
  }
  for (const day of discardedDays) {
    await events.deleteImportedOnDay(website._id, importId, day);
  }
  await sessions.deleteMany(opened);
}

/** What the rollup ledger says an import already counted, by day. */
async function readLedger(
  website: Website,
  importId: string,
): Promise<Map<number, AppliedImport>> {
  const rows = await GetModel(
    WebsiteStatisticsModel,
    website.tenantId,
  ).getDaysSince(website._id, 0);
  const ledger = new Map<number, AppliedImport>();
  for (const row of rows) {
    const applied = row.appliedImports?.find(
      (entry) => entry.importId === importId,
    );
    if (applied) ledger.set(row.day, applied);
  }
  return ledger;
}

/**
 * Replays the history day by day, skipping the days the ledger names. A day
 * commits as one write to its day row, so wherever a previous attempt stopped,
 * each day ends up counted exactly once.
 */
export async function replayAll(
  website: Website,
  importId: string,
  visitors: Map<string, VisitorEvent[]>,
  claim: ImportClaim,
  resuming: boolean,
): Promise<ReplayCounts> {
  const ledger = resuming
    ? await readLedger(website, importId)
    : new Map<number, AppliedImport>();
  if (resuming) {
    await discardUncommitted(website, importId, new Set(ledger.keys()));
  }
  const total: ReplayCounts = { sessions: 0, events: 0, dropped: 0 };
  for (const applied of ledger.values()) addCounts(total, applied);
  const days = batchesByDay(visitors);
  const statistics = GetModel(WebsiteStatisticsModel, website.tenantId);
  for (const day of [...days.keys()].sort((a, b) => a - b)) {
    if (ledger.has(day)) continue;
    const { deltas, counts } = await replayDay(
      website,
      importId,
      days.get(day)!,
      claim,
    );
    addCounts(total, counts);
    if (deltas.length > 0) {
      await commitImportedDay(statistics, website._id, day, deltas, {
        importId,
        ...counts,
      });
    }
  }
  return total;
}
