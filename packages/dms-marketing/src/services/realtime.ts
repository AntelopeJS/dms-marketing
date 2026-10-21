import { Logging } from "@antelopejs/interface-core/logging";
import { PublishMessage } from "@antelopejs/interface-dms/realtime";
import { MS_PER_SECOND } from "@/types/constants";

/**
 * The topic the analytics pages read again on: events, sessions or a page
 * snapshot were stored. Every block of those pages declares it as its
 * `realtimeTopic` (the context bar registers it on the custom-only pages), so
 * the page's Direct / Pause gate decides when an arrival turns into a read.
 */
export const MARKETING_EVENTS_TOPIC = "marketing.events";

const COLLECTED_TYPE = "collected";

/**
 * Arrivals are batched into one message per interval and instance: a busy
 * site sends a beacon per pageview, and the pages read at most once per their
 * `maxRate` anyway. The message carries `{ count }`, which a paused page adds
 * to its "N new".
 */
const PUBLISH_INTERVAL_MS = MS_PER_SECOND;

/** The arrivals waiting to be published, per tenant. */
const pending = new Map<string, number>();
let timer: NodeJS.Timeout | null = null;

/**
 * `count` events (or one snapshot) were stored for `tenantId`: that tenant's
 * pages hear of it within the publish interval. Never throws, and never
 * fails the write behind it.
 */
export function noteCollected(tenantId: string, count: number): void {
  if (count <= 0) {
    return;
  }
  pending.set(tenantId, (pending.get(tenantId) ?? 0) + count);
  if (!timer) {
    timer = setTimeout(flushCollected, PUBLISH_INTERVAL_MS);
    timer.unref();
  }
}

/** Drops what waits to be published (module stop). */
export function stopCollectedNotices(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  pending.clear();
}

function flushCollected(): void {
  const batches = [...pending];
  pending.clear();
  timer = null;
  for (const [tenantId, count] of batches) {
    publishCollected(tenantId, count);
  }
}

/**
 * The module's one publish, scoped to the tenant whose websites collected
 * (AntelopeJS/dms#353): only that tenant's analytics pages wake or count it
 * in their paused "N new". The payload names no website or event.
 */
function publishCollected(tenantId: string, count: number): void {
  // Through a promise: a DMS not answering yet throws rather than rejects.
  Promise.resolve()
    .then(() =>
      PublishMessage(MARKETING_EVENTS_TOPIC, COLLECTED_TYPE, {
        payload: { count },
        tenantId,
      }),
    )
    .catch((err: unknown) => {
      Logging.Warn(
        `[dms-marketing] could not publish on ${MARKETING_EVENTS_TOPIC}:`,
        err,
      );
    });
}
