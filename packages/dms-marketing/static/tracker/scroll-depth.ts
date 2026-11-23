import { currentPageUrl } from "../shared/page";
import { type Outbox, eventBase } from "./outbox";
import type { ScrollRoots } from "./scroll-root";
import type { TrackerSession } from "./session";

const PERCENT_SCALE = 100;

/** After a SPA navigation, time for the new view to render before its unscrolled depth is measured. */
const SCROLL_MEASURE_DELAY_MS = 1000;

/** The deepest point reached on the page on screen, as a percentage of what scrolls. */
export interface ScrollDepth {
  /** Starts measuring a new view: the URL it is measured against is kept, because a SPA navigation rewrites `location` before the depth of the page being left is flushed. */
  reset(): void;
  /** Queues the depth reached, once per measured view. */
  flush(): void;
  /**
   * Every sampled view reports a depth, scrolled or not: what shows without
   * scrolling is reached too (all of a page shorter than the window), and a
   * view that never scrolls belongs in the denominator.
   */
  scheduleMeasure(): void;
  /** Listens to scrolls: captured on the document because an element's scroll does not bubble and the window never hears it. */
  install(): void;
}

export function createScrollDepth(
  session: TrackerSession,
  outbox: Outbox,
  scrollRoots: ScrollRoots,
): ScrollDepth {
  let scrolledUrl: string | null = null;
  let maxScrollDepth = -1;

  function currentScrollDepth(): number {
    const inner = scrollRoots.current();
    const root = inner || document.documentElement;
    const scrollable = root.scrollHeight - root.clientHeight;
    if (scrollable <= 0) {
      return PERCENT_SCALE;
    }
    const scrolled = inner
      ? inner.scrollTop
      : root.scrollTop || document.body.scrollTop || 0;
    return Math.min(
      PERCENT_SCALE,
      Math.round((scrolled / scrollable) * PERCENT_SCALE),
    );
  }

  function measure(): void {
    const depth = currentScrollDepth();
    if (depth > maxScrollDepth) {
      maxScrollDepth = depth;
    }
  }

  return {
    reset() {
      scrolledUrl = currentPageUrl();
      maxScrollDepth = -1;
      scrollRoots.forget();
    },
    flush() {
      if (!session.heatmapSampled || maxScrollDepth < 0) {
        return;
      }
      outbox.enqueue({
        ...eventBase(),
        kind: "scroll",
        url: scrolledUrl || currentPageUrl(),
        data: { depth: maxScrollDepth },
      });
      maxScrollDepth = -1;
    },
    scheduleMeasure() {
      if (document.readyState === "complete") {
        setTimeout(measure, SCROLL_MEASURE_DELAY_MS);
        return;
      }
      window.addEventListener("load", measure, { once: true });
    },
    install() {
      document.addEventListener("scroll", measure, {
        capture: true,
        passive: true,
      });
    },
  };
}
