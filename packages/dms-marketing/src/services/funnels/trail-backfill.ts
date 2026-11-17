import { GetModel } from "@antelopejs/interface-database-decorators";
import {
  FunnelTrailBackfillsModel,
  FunnelTrailsModel,
  MarketingEventsModel,
  WebsitesModel,
} from "@/db";
import type { TrailedEvent } from "@/db/models/funnel_trails.model";
import type { MarketingEvent } from "@/db/tables/marketing_events.table";
import { isModulesStopping } from "@/services/modules-stopping";
import { MS_PER_HOUR } from "@/types/constants";

/**
 * Events per flush: the walk's memory bound, and what a stop loses. A flush
 * may run past it to keep the events of one timestamp together.
 */
const TRAIL_BACKFILL_FLUSH_EVENTS = 5000;

/**
 * How far before the start of the website's last complete walk each pass
 * walks it again: two prune periods. It heals a live batch whose events were
 * inserted but whose trail write failed, and the events an instance still on
 * the previous version inserted during a rolling deploy. Events the trails
 * already hold cost one read of their ids.
 */
const TRAIL_RECONCILE_MS = 2 * MS_PER_HOUR;

type WalkedEvent = TrailedEvent & Pick<MarketingEvent, "sessionId">;

/** One website's walk, in the purge generation it started in. */
interface Walk {
  tenantId: string;
  websiteId: string;
  generation: number;
}

/** A span of events to walk, newest first; null bounds are open. */
interface WalkSpan {
  below: Date | null;
  floor: Date | null;
  /** The walk moves the website's coverage down as it goes. */
  widens: boolean;
}

let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;

/**
 * Brings the funnel trails of every website of every tenant up to their raw
 * events, one website after the other: down from its coverage until the
 * oldest event, newest first, so the recent windows most reads ask for are
 * complete first, after a reconcile walk down to TRAIL_RECONCILE_MS before
 * the start of the last one that completed. Runs at
 * DATABASE_INITIALIZED and after each hourly prune; a walk stopped by an
 * error, a restart or the modules stopping resumes from its coverage on the
 * next pass. Failures are per website.
 *
 * One pass at a time per instance. A call during a pass queues one more
 * pass, shared by every call until it starts, so the returned promise always
 * settles after a pass that started after the call.
 */
export function backfillAllTenants(
  onError: (failure: Error) => void,
): Promise<void> {
  if (!running) {
    running = backfillPass(onError).finally(() => {
      running = null;
    });
    return running;
  }
  const again = () => {
    queued = null;
    return backfillAllTenants(onError);
  };
  queued ??= running.then(again, again);
  return queued;
}

async function backfillPass(onError: (failure: Error) => void): Promise<void> {
  const websites = GetModel(WebsitesModel);
  for (const tenantId of await websites.listTenantIds()) {
    for (const websiteId of await websites.listIdsByTenant(tenantId)) {
      if (isModulesStopping()) {
        return;
      }
      await backfillWebsite(tenantId, websiteId).catch((reason: unknown) => {
        onError(
          reason instanceof Error
            ? reason
            : new Error(String(reason), { cause: reason }),
        );
      });
    }
  }
}

/**
 * A website with no coverage is walked whole, from its newest event. A
 * covered one is reconciled from its newest event down to TRAIL_RECONCILE_MS
 * before the start of its last complete walk, or of this one when that is
 * later, then walked on below its coverage. A complete walk from the newest
 * event records its start for the next reconcile.
 */
async function backfillWebsite(
  tenantId: string,
  websiteId: string,
): Promise<void> {
  const backfills = GetModel(FunnelTrailBackfillsModel, tenantId);
  const { coverage, generation, reconcileStartedAt } =
    await backfills.begin(websiteId);
  const walk: Walk = { tenantId, websiteId, generation };
  const startedAt = Date.now();
  const fromNewest =
    coverage.kind === "none"
      ? await walkEvents(walk, { below: null, floor: null, widens: true })
      : await walkEvents(walk, {
          below: null,
          floor: new Date(
            Math.min(reconcileStartedAt ?? startedAt, startedAt) -
              TRAIL_RECONCILE_MS,
          ),
          widens: false,
        });
  if (!fromNewest) {
    return;
  }
  await backfills.reconciled(websiteId, generation, startedAt);
  if (coverage.kind === "above") {
    await walkEvents(walk, {
      below: new Date(coverage.through),
      floor: null,
      widens: true,
    });
  }
}

/**
 * Walks `span` newest first, through the events cursor, and records each
 * flush in the trails. A widening walk then moves the coverage down to the
 * flush's oldest timestamp, and marks the website complete when the cursor
 * runs out. Resolves to false when the walk stopped early.
 *
 * Live ingestion keeps writing meanwhile: an event it recorded first is
 * skipped by its id, an event it records after the walk passed was never
 * missing. A second walk over the same span adds nothing.
 */
async function walkEvents(walk: Walk, span: WalkSpan): Promise<boolean> {
  const events = GetModel(MarketingEventsModel, walk.tenantId).walkFunnelEvents(
    { websiteId: walk.websiteId, below: span.below, floor: span.floor },
  );
  let pending: WalkedEvent[] = [];
  for await (const event of events) {
    const last = pending.at(-1);
    if (
      last &&
      pending.length >= TRAIL_BACKFILL_FLUSH_EVENTS &&
      event.timestamp < last.timestamp
    ) {
      if (!(await flush(walk, pending, span.widens))) {
        return false;
      }
      pending = [];
    }
    pending.push(event);
  }
  if (pending.length > 0 && !(await flush(walk, pending, span.widens))) {
    return false;
  }
  if (span.widens) {
    await GetModel(FunnelTrailBackfillsModel, walk.tenantId).complete(
      walk.websiteId,
      walk.generation,
    );
  }
  return true;
}

/**
 * Records a flush of events, newest first, unless the modules are stopping or
 * the website's generation moved (or its row went) since the walk began:
 * events of the website are being deleted, and it must not write them back.
 * The generation is read again once the flush is written; when it moved
 * meanwhile, the flush takes back the events it wrote. Resolves to false when
 * the walk must stop.
 */
async function flush(
  walk: Walk,
  newestFirst: readonly WalkedEvent[],
  widens: boolean,
): Promise<boolean> {
  const backfills = GetModel(FunnelTrailBackfillsModel, walk.tenantId);
  const fenced = async () =>
    (await backfills.generationOf(walk.websiteId)) !== walk.generation;
  if (isModulesStopping() || (await fenced())) {
    return false;
  }
  const trails = GetModel(FunnelTrailsModel, walk.tenantId);
  const written = await trails.recordMany(
    walk.websiteId,
    bySessionInTimeOrder(newestFirst),
  );
  if (await fenced()) {
    await trails.forgetEvents(written);
    return false;
  }
  const oldest = newestFirst.at(-1);
  if (widens && oldest) {
    await backfills.widen(
      walk.websiteId,
      walk.generation,
      oldest.timestamp.getTime(),
    );
  }
  return true;
}

/**
 * Each session's events, oldest first. Read backwards, the cursor returns
 * the events of one timestamp in the reverse of their insertion order, so
 * reversing the list restores the order a forward read gives them.
 */
function bySessionInTimeOrder(
  newestFirst: readonly WalkedEvent[],
): Map<string, WalkedEvent[]> {
  const sessions = new Map<string, WalkedEvent[]>();
  for (const event of [...newestFirst].reverse()) {
    const events = sessions.get(event.sessionId);
    if (events) {
      events.push(event);
    } else {
      sessions.set(event.sessionId, [event]);
    }
  }
  return sessions;
}
