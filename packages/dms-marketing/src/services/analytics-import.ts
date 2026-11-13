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
import { isNumber, isString } from "@/utils/guards";
import {
  MAX_SCREEN_AND_LANGUAGE_CHARS,
  MAX_TRUSTED_CLIENT_CLOCK_SKEW_MS,
} from "@/types/constants";
import { acquireClaim } from "./analytics-import-claim";
import { replayAll, type VisitorEvent } from "./analytics-import-replay";
import { prepareEvents } from "./collect";
import {
  declaredTenant,
  describeIssue,
  instantOf,
  MarketingDeclarationError,
  requireDeclaredId,
} from "./declarations";
import { isAutomatedClient } from "./ingest-guard";
import { parseDevice } from "./user-agent";

const OPERATION = "ImportAnalytics";

/** One call carries a bounded slice of history; split a larger one. */
const MAX_IMPORT_SESSIONS = 10_000;
const MAX_IMPORT_EVENTS_PER_SESSION = 1000;
const MAX_VISITOR_KEY_LENGTH = 200;
const MAX_USER_AGENT_LENGTH = 1000;
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

function refuse(id: string, reason: string): MarketingDeclarationError {
  return new MarketingDeclarationError(OPERATION, id, reason);
}

function importRowId(websiteId: string, importId: string): string {
  return `${websiteId}:${importId}`;
}

/** An import event as the caller sent it: only the fields read are named. */
const importedEventSchema = z.object({
  kind: z.unknown(),
  at: z.unknown(),
  url: z.unknown(),
  referrer: z.unknown(),
  title: z.unknown(),
  name: z.unknown(),
  data: z.unknown(),
});

type ImportedEvent = z.output<typeof importedEventSchema>;

/** An import event in the tracker's own shape, for the collect schema. */
function asTrackedEvent(event: ImportedEvent, session: ImportSession) {
  const at =
    isNumber(event.at) || isString(event.at) ? instantOf(event.at) : undefined;
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
    const tracked = session.events.flatMap((raw) => {
      const parsed = importedEventSchema.safeParse(raw);
      const event = parsed.success
        ? asTrackedEvent(parsed.data, session)
        : undefined;
      return event ? [event] : [];
    });
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

/** An unfinished import that writes through the rollup ledger. */
function isResumable(row: MarketingImport): boolean {
  return row.status !== "done" && row.ledgered === true;
}

/** What a call answers for an import id it finds already claimed. */
const CLAIMED_STATUS = {
  running: "in_progress",
  done: "skipped",
  failed: "failed",
} as const satisfies Record<MarketingImport["status"], string>;

/**
 * A resumable import answers `in_progress` whatever its status: its holder
 * replays it, or a later call resumes it.
 */
function claimed(row: MarketingImport): MarketingImportResult {
  return {
    importId: row.importId,
    status: isResumable(row) ? "in_progress" : CLAIMED_STATUS[row.status],
    sessions: row.sessions,
    events: row.events,
    dropped: row.dropped,
  };
}

/**
 * The newest instant the website's other imports filled. Refuses while one of
 * them is unfinished, or when this import would write before that instant.
 */
function chronologyBoundary(
  importId: string,
  others: MarketingImport[],
  earliest: number,
): number {
  let importedThrough = 0;
  for (const previous of others) {
    if (previous.status !== "done" || previous.importedThrough == null) {
      throw refuse(
        importId,
        previous.ledgered
          ? `the import "${previous.importId}" did not finish; call it again before importing more history`
          : "previous import needs reconciliation before more history can be imported",
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
  return importedThrough;
}

/**
 * ImportAnalytics: claims the website for the import id, then replays the
 * history. Claimed first, so a second call — another instance booting the
 * same project, the next boot — is not counted twice: it answers
 * `in_progress` while the first is still replaying and `skipped` once it is
 * done. A call that finds the import stopped part-way, because it failed or its
 * process died, resumes it: raw rows on days the ledger does not name are taken
 * back, and those days are replayed.
 *
 * The events are prepared before the claim, so a validation failure has written
 * no analytics. The claim is a row under the empty import id, which no caller
 * can declare, so it cannot collide with a caller's id; its plain insert gives
 * one writer per website across instances.
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
  if (applied && !isResumable(applied)) {
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
    ledgered: true,
  };
  const claimId = importRowId(websiteId, "");
  const attempt = await acquireClaim(imports, { ...row, _id: claimId });
  if (attempt.kind === "owned") {
    if (attempt.owner.importId === importId) {
      return claimed(attempt.owner);
    }
    throw refuse(
      importId,
      `another import ("${attempt.owner.importId}") owns this website; retry after it completes, or call it again if it stopped`,
    );
  }
  const { claim } = attempt;

  let importedThrough: number;
  let resuming: boolean;
  try {
    const current = await imports.get(rowId);
    resuming = current !== undefined;
    if (current && !isResumable(current)) {
      await claim.release();
      return claimed(current);
    }
    importedThrough = chronologyBoundary(
      importId,
      (await imports.listByWebsite(websiteId)).filter(
        (previous) => previous._id !== claimId && previous._id !== rowId,
      ),
      earliest,
    );
    if (current) {
      await imports.update(rowId, { status: "running" });
    } else {
      try {
        await imports.insert(row);
      } catch (err) {
        const existing = await imports.get(rowId);
        if (!existing) throw err;
        await claim.release().catch(() => {});
        return claimed(existing);
      }
    }
  } catch (err) {
    await claim.release();
    throw err;
  }

  try {
    const counts = await replayAll(
      website,
      importId,
      visitors,
      claim,
      resuming,
    );
    counts.dropped += dropped;
    await imports.update(rowId, {
      status: "done",
      ...counts,
      importedThrough: new Date(Math.max(importedThrough, latest)),
      finishedAt: new Date(),
    });
    await claim.release();
    return { importId, status: "imported", ...counts };
  } catch (err) {
    await imports
      .update(rowId, { status: "failed", dropped, finishedAt: new Date() })
      .catch(() => {});
    await claim.release().catch(() => {});
    throw refuse(
      importId,
      `failed part-way; call it again to resume: ${err instanceof Error ? describeIssue(err) : String(err)}`,
    );
  }
}
