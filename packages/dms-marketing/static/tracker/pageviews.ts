import { isExcludedPath } from "./excluded-paths";
import { type Outbox, eventBase } from "./outbox";
import type { ScrollDepth } from "./scroll-depth";
import type { TrackerSession } from "./session";
import type { SnapshotRequests } from "./snapshot-request";

/** Counts the pages of the visit: the initial load and every SPA navigation. */
export interface Pageviews {
  /** Counts the page on screen unless it is the one already counted. */
  track(): void;
  /** Counts the page on screen again, for the website the tag names now. */
  retrack(): void;
  /**
   * Hooks pushState and replaceState (a client-side redirect lands on a page
   * too); a same-path call, a query or hash update, is no navigation.
   */
  install(): void;
}

export function createPageviews(
  session: TrackerSession,
  outbox: Outbox,
  scrollDepth: ScrollDepth,
  snapshots: SnapshotRequests,
): Pageviews {
  let lastPath: string | null = null;

  function track(): void {
    if (location.pathname === lastPath) {
      return;
    }
    scrollDepth.flush();
    lastPath = location.pathname;
    session.pageExcluded = isExcludedPath(session.excludedPaths, lastPath);
    scrollDepth.reset();
    if (!session.websiteId || session.pageExcluded) {
      return;
    }
    outbox.enqueue({
      ...eventBase(),
      kind: "pageview",
      data: { sample: session.sampleRate },
    });
    scrollDepth.scheduleMeasure();
    snapshots.schedule();
  }

  function retrack(): void {
    lastPath = null;
    track();
  }

  function hookHistory(method: "pushState" | "replaceState"): void {
    const original = history[method].bind(history);
    history[method] = function navigate(...args) {
      original(...args);
      track();
    };
  }

  return {
    track,
    retrack,
    install() {
      hookHistory("pushState");
      hookHistory("replaceState");
      window.addEventListener("popstate", track);
      window.addEventListener("pageshow", (event) => {
        if (event.persisted) {
          retrack();
        }
      });
    },
  };
}
