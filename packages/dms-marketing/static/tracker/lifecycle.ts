import type { Experiments } from "./experiments";
import type { Outbox } from "./outbox";
import type { Pageviews } from "./pageviews";
import type { ScrollDepth } from "./scroll-depth";
import { type TrackerSession, tagWebsiteId } from "./session";

/**
 * Flushes what was collected when the page is hidden or left, and follows the
 * tag's `data-website-id`: when it changes, what was collected so far leaves
 * under the previous website, and the page on screen counts for the new one.
 * The dashboard's own tag relies on it to follow sign-out and workspace
 * switches without a reload.
 */
export function installLifecycle(
  session: TrackerSession,
  outbox: Outbox,
  scrollDepth: ScrollDepth,
  experiments: Experiments,
  pageviews: Pageviews,
): void {
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      scrollDepth.flush();
      outbox.flush();
    }
  });
  window.addEventListener("pagehide", () => {
    scrollDepth.flush();
    outbox.flush();
  });

  const followWebsiteId = () => {
    const next = tagWebsiteId(session);
    if (next === session.websiteId) {
      return;
    }
    scrollDepth.flush();
    outbox.flush();
    session.websiteId = next;
    experiments.reset();
    pageviews.retrack();
  };
  if (typeof MutationObserver !== "undefined") {
    new MutationObserver(followWebsiteId).observe(session.script, {
      attributes: true,
      attributeFilter: ["data-website-id"],
    });
  }
}
