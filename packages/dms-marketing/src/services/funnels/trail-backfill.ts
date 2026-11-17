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

const TRAIL_BACKFILL_FLUSH_EVENTS = 5000;

const TRAIL_RECONCILE_MS = 2 * MS_PER_HOUR;

type WalkedEvent = TrailedEvent & Pick<MarketingEvent, "sessionId">;

interface Walk {
  tenantId: string;
  websiteId: string;
  generation: number;
}

interface WalkSpan {
  below: Date | null;
  floor: Date | null;
  widensCoverage: boolean;
}

let running: Promise<void> | null = null;
let queued: Promise<void> | null = null;

/**
 * Brings the funnel trails of every website of every tenant up to their raw
 * events, one website after the other: down from its coverage until the
 * oldest event, newest first, so the recent windows most reads ask for are
 * complete first, after a reconcile walk down to TRAIL_RECONCILE_MS before
 * the start of the last one that completed. A walk stopped by an error, a
 * restart or the modules stopping resumes from its coverage on the next
 * pass. Failures are per website.
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

async function backfillWebsite(
  tenantId: string,
  websiteId: string,
): Promise<void> {
  const backfills = GetModel(FunnelTrailBackfillsModel, tenantId);
  let start = await backfills.begin(websiteId);
  if (start.kind === "outdated") {
    await GetModel(FunnelTrailsModel, tenantId).deleteByWebsite(websiteId);
    start = await backfills.restart(websiteId);
  }
  if (start.kind !== "walk") {
    return;
  }
  const { coverage, generation, reconcileStartedAt } = start;
  const walk: Walk = { tenantId, websiteId, generation };
  const startedAt = Date.now();
  const fromNewest =
    coverage.kind === "none"
      ? await walkEvents(walk, {
          below: null,
          floor: null,
          widensCoverage: true,
        })
      : await walkEvents(walk, {
          below: null,
          floor: new Date(
            Math.min(reconcileStartedAt ?? startedAt, startedAt) -
              TRAIL_RECONCILE_MS,
          ),
          widensCoverage: false,
        });
  if (!fromNewest) {
    return;
  }
  await backfills.reconciled(websiteId, generation, startedAt);
  if (coverage.kind === "above") {
    await walkEvents(walk, {
      below: new Date(coverage.through),
      floor: null,
      widensCoverage: true,
    });
  }
}

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
      if (!(await flush(walk, pending, span.widensCoverage))) {
        return false;
      }
      pending = [];
    }
    pending.push(event);
  }
  if (
    pending.length > 0 &&
    !(await flush(walk, pending, span.widensCoverage))
  ) {
    return false;
  }
  if (span.widensCoverage) {
    await GetModel(FunnelTrailBackfillsModel, walk.tenantId).complete(
      walk.websiteId,
      walk.generation,
    );
  }
  return true;
}

async function flush(
  walk: Walk,
  newestFirst: readonly WalkedEvent[],
  widensCoverage: boolean,
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
  if (widensCoverage && oldest) {
    await backfills.widen(
      walk.websiteId,
      walk.generation,
      oldest.timestamp.getTime(),
    );
  }
  return true;
}

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
