import { MAX_URL_LENGTH, currentPageUrl } from "../shared/page";
import { type TrackerSession, isAimed } from "./session";

const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH = 25;

/** Mirrors the backend MAX_TITLE_LENGTH. */
const MAX_TITLE_LENGTH = 200;

/** A value the backend accepts in an event's data. */
type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** The payload of an event: what page code passes to `track`, or what the tracker measures. */
export interface EventData {
  readonly [key: string]: JsonValue;
}

/** What every event carries about the page and the visitor's browser. */
export interface EventBase {
  readonly url: string;
  readonly referrer: string | undefined;
  readonly title: string | undefined;
  readonly screen: string;
  readonly language: string | undefined;
  readonly at: number;
}

/** One event of the collect contract. */
interface TrackerEvent extends EventBase {
  readonly kind: "pageview" | "scroll" | "click" | "exposure" | "custom";
  readonly name?: string;
  readonly data?: EventData;
}

/** The fields every event carries, read from the page as it is now. */
export function eventBase(): EventBase {
  return {
    url: currentPageUrl(),
    referrer: document.referrer.slice(0, MAX_URL_LENGTH) || undefined,
    title: document.title.slice(0, MAX_TITLE_LENGTH) || undefined,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language || undefined,
    at: Date.now(),
  };
}

/** The events waiting to leave the page, batched and flushed with `sendBeacon` so a page unload loses nothing. */
export interface Outbox {
  /**
   * Queues `event` for the session's website and flushes once a batch is
   * full. Nothing is queued while the page is excluded or the tag no longer
   * names the session's website: attribute writes are synchronous while the
   * observer that retargets the session is not, so until retargeting
   * completes no new event goes in the old queue.
   */
  enqueue(event: TrackerEvent): void;
  /** Sends everything queued, in batches, under the session's website. */
  flush(): void;
}

/** text/plain is CORS-safelisted: no preflight, no CORS grant needed. */
function send(endpoint: string, body: string): void {
  if (navigator.sendBeacon) {
    navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }));
    return;
  }
  fetch(endpoint, { method: "POST", body, keepalive: true }).catch(() => {});
}

export function createOutbox(session: TrackerSession): Outbox {
  const endpoint = `${session.hostUrl}/api/marketing/collect`;
  const queue: TrackerEvent[] = [];
  let flushTimer: number | null = null;

  function flush(): void {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    while (queue.length > 0) {
      const events = queue.splice(0, MAX_BATCH);
      send(endpoint, JSON.stringify({ website: session.websiteId, events }));
    }
  }

  function enqueue(event: TrackerEvent): void {
    if (!isAimed(session) || session.pageExcluded) {
      return;
    }
    queue.push(event);
    if (queue.length >= MAX_BATCH) {
      flush();
      return;
    }
    if (!flushTimer) {
      flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
    }
  }

  return { enqueue, flush };
}
