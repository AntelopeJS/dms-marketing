/**
 * dms-marketing first-party tracker.
 *
 * Embed on any page rendered by a DMS-powered site:
 *   <script defer src="https://<backend>/api/marketing/tracker.js"
 *           data-website-id="<website id>"></script>
 *
 * Optional attributes:
 *   data-host-url        override the collect origin (defaults to the script origin)
 *   data-heatmap-sample  0-1 click/scroll sampling rate; overrides the module setting
 *   data-do-not-track    "false" to ignore the browser DNT signal
 *
 * Cookieless by design: no identifier is generated or stored client-side —
 * the backend derives an anonymous visitor hash per request. Payload shape
 * follows the Umami tracker fields; events are batched and flushed with
 * sendBeacon so page unloads lose nothing.
 *
 * A/B experiments: `await window.dmsMarketing.variation("key")` resolves the
 * variation the backend assigned this visitor (loaded lazily from
 * experiments.js) and reports the exposure. Browser-side only — assignment
 * derives from the visitor's own request.
 *
 * Served, not static: the tracker route prepends the module's effective
 * settings (see docs/usage/tracking.md) so the Settings page
 * actually drives sampling.
 *
 * Page snapshots: on a visit sampled for clicks, once the page has loaded
 * and gone idle, the tracker asks the backend whether it wants a capture of
 * this page at this width. The answer is the capture script itself
 * (static/snapshot.js) or nothing — so a visit never serializes a page
 * nobody will keep, and a page is captured about once a day however busy
 * it is. Off unless the website opted in.
 */
(() => {
  /** Global the tracker route injects the module settings through. */
  const CONFIG_GLOBAL = "__dmsMarketingTrackerConfig";
  /** Global the capture script (snapshot.js) reads its page context from. */
  const SNAPSHOT_CONTEXT_GLOBAL = "__dmsMarketingSnapshotContext";

  const DEFAULT_SAMPLE_RATE = 0.1;
  const FLUSH_INTERVAL_MS = 5000;
  const MAX_BATCH = 25;
  /** Mirrors the backend MAX_URL_LENGTH: a longer field fails validation. */
  const MAX_URL_LENGTH = 500;
  const MAX_SELECTOR_LENGTH = 120;
  const SELECTOR_DEPTH = 3;
  const COORDINATE_PRECISION = 4;
  const PERCENT_SCALE = 100;
  /** Grace after load before asking for a capture: lazy content and
   * hydration have usually landed; the capture waits for DOM quiet on top. */
  const SNAPSHOT_DELAY_MS = 3000;
  /** SPA navigations may ask again, this many times per page load. */
  const MAX_SNAPSHOTS_PER_LOAD = 3;

  // --- Public API -----------------------------------------------------------

  /** The no-op variation() resolves null: a visitor that collects nothing
   * (DNT) renders the control. */
  const NOOP_API = {
    track() {},
    exposure() {},
    variation() {
      return Promise.resolve(null);
    },
  };

  /** Installed on every path, including the ones that collect nothing, so
   * `window.dmsMarketing.track(…)` in page code never throws. */
  function publishApi(api) {
    window.dmsMarketing = api || NOOP_API;
  }

  // --- Configuration --------------------------------------------------------

  const script = document.currentScript;
  if (!script) {
    return;
  }

  /** Read once and removed: the injected settings are not a page-facing API. */
  function servedConfig() {
    const injected = window[CONFIG_GLOBAL];
    delete window[CONFIG_GLOBAL];
    return injected && typeof injected === "object" ? injected : {};
  }

  function firstFiniteNumber(values) {
    return values.find((value) => Number.isFinite(value));
  }

  /** Embed attribute wins over the module setting, which wins over the default. */
  function resolveSampleRate(attribute, served) {
    const rate = firstFiniteNumber([
      attribute === null ? Number.NaN : Number.parseFloat(attribute),
      served.heatmapSampleRate,
      DEFAULT_SAMPLE_RATE,
    ]);
    return Math.min(Math.max(rate, 0), 1);
  }

  const config = servedConfig();
  const websiteId = script.getAttribute("data-website-id");
  if (!websiteId) {
    publishApi();
    return;
  }

  const respectDnt = script.getAttribute("data-do-not-track") !== "false";
  const dntEnabled = navigator.doNotTrack === "1" || window.doNotTrack === "1";
  if (respectDnt && dntEnabled) {
    publishApi();
    return;
  }

  const hostUrl =
    script.getAttribute("data-host-url") || new URL(script.src).origin;
  const endpoint = `${hostUrl}/api/marketing/collect`;
  const sampleRate = resolveSampleRate(
    script.getAttribute("data-heatmap-sample"),
    config,
  );

  const heatmapSampled = Math.random() < sampleRate;
  const queue = [];
  let flushTimer = null;

  /** Absolute: the backend stores the path only, but needs the hostname to
   * tell an internal navigation from an acquisition referrer. */
  const currentUrl = () =>
    (location.origin + location.pathname + location.search).slice(
      0,
      MAX_URL_LENGTH,
    );

  const base = () => ({
    url: currentUrl(),
    referrer: document.referrer.slice(0, MAX_URL_LENGTH) || undefined,
    title: document.title || undefined,
    screen: `${screen.width}x${screen.height}`,
    language: navigator.language || undefined,
    at: Date.now(),
  });

  /** text/plain is CORS-safelisted: no preflight, no CORS grant needed. */
  function send(body) {
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: "text/plain" }));
      return;
    }
    fetch(endpoint, { method: "POST", body, keepalive: true }).catch(() => {});
  }

  function flush() {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    while (queue.length > 0) {
      const events = queue.splice(0, MAX_BATCH);
      send(JSON.stringify({ website: websiteId, events }));
    }
  }

  function enqueue(event) {
    queue.push(event);
    if (queue.length >= MAX_BATCH) {
      flush();
      return;
    }
    if (!flushTimer) {
      flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
    }
  }

  // --- Pageviews (initial + SPA navigations) --------------------------------

  let lastPath = null;
  /** URL the scroll depth is being measured against — kept because a SPA
   * navigation rewrites `location` before the depth of the page being left
   * is flushed. */
  let scrolledUrl = null;
  let maxScrollDepth = 0;

  function trackPageview() {
    if (location.pathname === lastPath) {
      return;
    }
    flushScrollDepth();
    lastPath = location.pathname;
    scrolledUrl = currentUrl();
    maxScrollDepth = 0;
    enqueue(Object.assign(base(), { kind: "pageview" }));
    scheduleSnapshot();
  }

  const originalPushState = history.pushState;
  history.pushState = function pushState(...args) {
    originalPushState.apply(this, args);
    trackPageview();
  };
  window.addEventListener("popstate", trackPageview);

  // --- Scroll depth (max reached per page, flushed on leave) ----------------

  function currentScrollDepth() {
    const root = document.documentElement;
    const scrollable = root.scrollHeight - root.clientHeight;
    if (scrollable <= 0) {
      return PERCENT_SCALE;
    }
    const scrolled = root.scrollTop || document.body.scrollTop || 0;
    return Math.min(
      PERCENT_SCALE,
      Math.round((scrolled / scrollable) * PERCENT_SCALE),
    );
  }

  window.addEventListener(
    "scroll",
    () => {
      const depth = currentScrollDepth();
      if (depth > maxScrollDepth) {
        maxScrollDepth = depth;
      }
    },
    { passive: true },
  );

  function flushScrollDepth() {
    if (!heatmapSampled || maxScrollDepth <= 0) {
      return;
    }
    enqueue(
      Object.assign(base(), {
        kind: "scroll",
        url: scrolledUrl || currentUrl(),
        data: { depth: maxScrollDepth },
      }),
    );
    maxScrollDepth = 0;
  }

  // --- Click capture (sampled, viewport-normalized) -------------------------

  function shortSelector(element) {
    const parts = [];
    let node = element;
    for (let depth = 0; node && depth < SELECTOR_DEPTH; depth++) {
      if (node.id) {
        parts.unshift(`#${node.id}`);
        break;
      }
      const classes = Array.from(node.classList).slice(0, 2).join(".");
      parts.unshift(classes ? `${node.localName}.${classes}` : node.localName);
      node = node.parentElement;
    }
    return parts.join(">").slice(0, MAX_SELECTOR_LENGTH);
  }

  function normalized(value, total) {
    if (total <= 0) {
      return 0;
    }
    return Number(Math.min(value / total, 1).toFixed(COORDINATE_PRECISION));
  }

  function rounded(value) {
    return Number(
      Math.min(Math.max(value, 0), 1).toFixed(COORDINATE_PRECISION),
    );
  }

  /**
   * Where the click landed inside the element it hit, so the point survives
   * being read back at another window size. Document fractions do not: they
   * divide by `scrollHeight`, which on a page shorter than the window IS the
   * window, and the same button then stores a different fraction per visitor.
   *
   * The document itself is excluded — its box is the viewport, so anchoring
   * to it would carry the very dependency being escaped, at the cost of a
   * lookup. Those clicks keep the document fractions alone.
   *
   * `nth` disambiguates: `shortSelector` stops at three levels and can match
   * several elements, and the embedder resolving it would otherwise land on
   * whichever comes first in the document.
   */
  function elementAnchor(target, event) {
    if (target === document.body || target === document.documentElement) {
      return null;
    }
    const selector = shortSelector(target);
    if (!selector) {
      return null;
    }
    const box = target.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) {
      return null;
    }
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      // A class containing CSS-significant characters can produce a selector
      // that never parses; the click is still worth its document fractions.
      return null;
    }
    const nth = Array.prototype.indexOf.call(matches, target);
    if (nth < 0) {
      return null;
    }
    return {
      selector: selector,
      ox: rounded((event.clientX - box.left) / box.width),
      oy: rounded((event.clientY - box.top) / box.height),
      nth: nth,
    };
  }

  document.addEventListener(
    "click",
    (event) => {
      if (!heatmapSampled) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const doc = document.documentElement;
      enqueue(
        Object.assign(base(), {
          kind: "click",
          data: Object.assign(
            {
              x: normalized(event.clientX, innerWidth),
              y: normalized(event.clientY, innerHeight),
              dx: normalized(event.pageX, doc.scrollWidth),
              dy: normalized(event.pageY, doc.scrollHeight),
              selector: shortSelector(target),
            },
            elementAnchor(target, event),
          ),
        }),
      );
    },
    { capture: true, passive: true },
  );

  // --- Page snapshots (negotiated, sampled with the clicks) -----------------

  const snapshotEndpoint = `${hostUrl}/api/marketing/snapshot`;
  let snapshotsRequested = 0;

  /**
   * Ask whether the backend wants a capture of this page at this width; the
   * answer is the capture script itself, or nothing. Only on visits already
   * sampled for clicks — a backdrop is for pages with clicks — and never
   * from inside a frame, a hidden tab or a prerender: none of them is what
   * the visitor saw.
   */
  function requestSnapshot() {
    if (
      !heatmapSampled ||
      snapshotsRequested >= MAX_SNAPSHOTS_PER_LOAD ||
      window.top !== window ||
      document.visibilityState !== "visible" ||
      innerWidth <= 0
    ) {
      return;
    }
    snapshotsRequested++;
    const path = location.pathname;
    window[SNAPSHOT_CONTEXT_GLOBAL] = {
      website: websiteId,
      endpoint: snapshotEndpoint,
      path: path,
    };
    const loader = document.createElement("script");
    loader.async = true;
    loader.src =
      `${hostUrl}/api/marketing/snapshot.js?website=${encodeURIComponent(websiteId)}` +
      `&path=${encodeURIComponent(path)}&width=${innerWidth}`;
    const settle = () => loader.remove();
    loader.addEventListener("load", settle);
    loader.addEventListener("error", settle);
    document.head.appendChild(loader);
  }

  function whenIdle(callback) {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(callback);
      return;
    }
    setTimeout(callback, 0);
  }

  /** After load, a grace period and in idle time: the capture must never
   * compete with the page's own work. */
  function scheduleSnapshot() {
    const later = () => {
      setTimeout(() => whenIdle(requestSnapshot), SNAPSHOT_DELAY_MS);
    };
    if (document.readyState === "complete") {
      later();
      return;
    }
    window.addEventListener("load", later, { once: true });
  }

  // --- Experiments ----------------------------------------------------------

  /** Global the assignments script (experiments.js) publishes through. */
  const ASSIGNMENTS_GLOBAL = "__dmsMarketingAssignments";

  let assignmentsPromise = null;

  /**
   * Lazy: the request fires on the first variation() call only, so the many
   * pages without experiments never pay it. A <script src> rather than a
   * fetch() because reading a cross-origin response would need the CORS
   * grant client sites are promised never to need; per-visitor, so the
   * backend serves it no-store and it must never ride inside tracker.js
   * (which is cached shared for an hour).
   */
  function loadAssignments() {
    if (!assignmentsPromise) {
      assignmentsPromise = new Promise((resolve) => {
        const loader = document.createElement("script");
        loader.async = true;
        loader.src =
          `${hostUrl}/api/marketing/experiments.js?website=` +
          encodeURIComponent(websiteId);
        function settle() {
          const assignments = window[ASSIGNMENTS_GLOBAL];
          delete window[ASSIGNMENTS_GLOBAL];
          loader.remove();
          resolve(
            assignments && typeof assignments === "object" ? assignments : {},
          );
        }
        loader.addEventListener("load", settle);
        loader.addEventListener("error", settle);
        document.head.appendChild(loader);
      });
    }
    return assignmentsPromise;
  }

  /** One exposure per experiment per page load — all the per-session variation
   * split needs, and what keeps long SPA sessions from flooding collect. */
  const exposedExperiments = new Set();

  function reportExposure(experiment, variation) {
    if (exposedExperiments.has(experiment)) {
      return;
    }
    exposedExperiments.add(experiment);
    enqueue(
      Object.assign(base(), {
        kind: "exposure",
        name: experiment,
        data: { experiment: experiment, variation: variation },
      }),
    );
  }

  publishApi({
    track(name, data) {
      enqueue(Object.assign(base(), { kind: "custom", name, data }));
    },
    /** Assigned variation of a running experiment, or null. Reports the
     * exposure, so only call it where the variation is actually applied. */
    variation(experiment) {
      return loadAssignments().then((assignments) => {
        const assigned = assignments[experiment];
        if (typeof assigned !== "string") {
          return null;
        }
        reportExposure(experiment, assigned);
        return assigned;
      });
    },
    /** Low-level escape hatch for integrations that assign on their own. */
    exposure(experiment, variation) {
      reportExposure(experiment, variation);
    },
  });

  // --- Lifecycle ------------------------------------------------------------

  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushScrollDepth();
      flush();
    }
  });
  window.addEventListener("pagehide", () => {
    flushScrollDepth();
    flush();
  });

  trackPageview();
})();
