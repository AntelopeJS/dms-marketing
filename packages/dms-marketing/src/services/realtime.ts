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

let pending = 0;
let timer: NodeJS.Timeout | null = null;

/**
 * `count` events (or one snapshot) were stored: the pages hear of it within
 * the publish interval. Never throws, and never fails the write behind it.
 */
export function noteCollected(count: number): void {
  if (count <= 0) {
    return;
  }
  pending += count;
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
  pending = 0;
}

function flushCollected(): void {
  const count = pending;
  pending = 0;
  timer = null;
  publishCollected(count);
}

/**
 * The module's one publish. DMS page topics are not scoped to a tenant yet:
 * every session on an analytics page hears every tenant's arrivals, which
 * wake its blocks (at most once per `maxRate`) and count in its paused
 * "N new". The payload names no tenant, website or event. Once the DMS scopes
 * a topic to a tenant, the batch is kept per tenant and the tenant goes here.
 */
function publishCollected(count: number): void {
  // Through a promise: a DMS not answering yet throws rather than rejects.
  Promise.resolve()
    .then(() =>
      PublishMessage(MARKETING_EVENTS_TOPIC, COLLECTED_TYPE, {
        payload: { count },
      }),
    )
    .catch((err: unknown) => {
      Logging.Warn(
        `[dms-marketing] could not publish on ${MARKETING_EVENTS_TOPIC}:`,
        err,
      );
    });
}
