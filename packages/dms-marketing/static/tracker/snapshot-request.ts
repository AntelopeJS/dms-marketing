import { whenIdle } from "../shared/page";
import type { SnapshotContext } from "../shared/wire";
import type { Outbox } from "./outbox";
import { findScrollRoot, type ScrollRoots } from "./scroll-root";
import { type TrackerSession, tagNamesWebsite } from "./session";

/** Grace after load before asking for a capture: lazy content and hydration have usually landed; the capture waits for DOM quiet on top. */
const SNAPSHOT_DELAY_MS = 3000;

/** SPA navigations may ask again, this many times per page load. */
const MAX_SNAPSHOTS_PER_LOAD = 3;

/** Negotiates page captures with the backend. */
export interface SnapshotRequests {
  /**
   * Asks, after load, a grace period and in idle time (the capture must never
   * compete with the page's own work), whether the backend wants a capture of
   * this page at this width. The answer is the capture script itself, or
   * nothing. Only on visits already sampled for clicks, since a backdrop is
   * for pages with clicks, and never from inside a frame, a hidden tab or a
   * prerender: none of them is what the visitor saw.
   */
  schedule(): void;
}

export function createSnapshotRequests(
  session: TrackerSession,
  outbox: Outbox,
  scrollRoots: ScrollRoots,
): SnapshotRequests {
  const snapshotEndpoint = `${session.hostUrl}/api/marketing/snapshot`;
  let snapshotsRequested = 0;

  function requestSnapshot(): void {
    const website = session.websiteId;
    if (
      !session.heatmapSampled ||
      !website ||
      !tagNamesWebsite(session, website) ||
      session.pageExcluded ||
      snapshotsRequested >= MAX_SNAPSHOTS_PER_LOAD ||
      window.top !== window ||
      document.visibilityState !== "visible" ||
      innerWidth <= 0
    ) {
      return;
    }
    snapshotsRequested++;
    outbox.flush();
    const path = location.pathname;
    const context: SnapshotContext = {
      website,
      endpoint: snapshotEndpoint,
      path,
      scrollRoot: findScrollRoot,
    };
    window.__dmsMarketingSnapshotContext = context;
    const loader = document.createElement("script");
    loader.async = true;
    loader.src =
      `${session.hostUrl}/api/marketing/snapshot.js?website=${encodeURIComponent(website)}` +
      `&path=${encodeURIComponent(path)}&width=${innerWidth}` +
      (scrollRoots.current() ? "&root=1" : "");
    const settle = () => loader.remove();
    loader.addEventListener("load", settle);
    loader.addEventListener("error", settle);
    document.head.appendChild(loader);
  }

  return {
    schedule() {
      const later = () => {
        setTimeout(() => whenIdle(requestSnapshot), SNAPSHOT_DELAY_MS);
      };
      if (document.readyState === "complete") {
        later();
        return;
      }
      window.addEventListener("load", later, { once: true });
    },
  };
}
