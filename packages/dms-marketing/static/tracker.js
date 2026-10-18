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
 *   data-do-not-track    "false" to ignore the browser DNT and GPC signals
 *   data-exclude-paths   comma-separated pages left uncounted: `/x` (that
 *                        page), `/x/*` (one segment below) or `/x/**` (the
 *                        page and everything below)
 *
 * The tag stays live: changing its `data-website-id` sends what follows to
 * that website, and removing it pauses collection until one is set again.
 * The dashboard's own tag relies on it to follow sign-out and workspace
 * switches without a reload.
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
 *
 * Scroll root: an app shell often keeps its document still and scrolls an
 * inner container instead (a dashboard panel, a sidebar layout). When the
 * document does not scroll, the page's scroll root is the element marked
 * `data-marketing-scroll-root` if there is one, else the largest visible
 * element scrolling vertically (overflow-y auto or scroll, content taller
 * than its box) that covers most of the window; the document otherwise.
 */
(() => {
  /** Global the tracker route injects the module settings through. */
  const CONFIG_GLOBAL = "__dmsMarketingTrackerConfig";
  /** Global the capture script (snapshot.js) reads its page context from. */
  const SNAPSHOT_CONTEXT_GLOBAL = "__dmsMarketingSnapshotContext";
  /** Set by the first tracker that starts collecting on the page. */
  const INSTALLED_GLOBAL = "__dmsMarketingInstalled";

  const DEFAULT_SAMPLE_RATE = 0.1;
  const FLUSH_INTERVAL_MS = 5000;
  const MAX_BATCH = 25;
  /** Mirror the backend caps (MAX_URL_LENGTH, MAX_TITLE_LENGTH,
   * MAX_EVENT_NAME_LENGTH): cut here, nothing is lost to validation. */
  const MAX_URL_LENGTH = 500;
  const MAX_TITLE_LENGTH = 200;
  const MAX_EVENT_NAME_LENGTH = 50;
  const MAX_SELECTOR_LENGTH = 120;
  const SELECTOR_DEPTH = 3;
  const COORDINATE_PRECISION = 4;
  const PERCENT_SCALE = 100;
  /** Grace after load before asking for a capture: lazy content and
   * hydration have usually landed; the capture waits for DOM quiet on top. */
  const SNAPSHOT_DELAY_MS = 3000;
  /** SPA navigations may ask again, this many times per page load. */
  const MAX_SNAPSHOTS_PER_LOAD = 3;
  /** After a SPA navigation, time for the new view to render before its
   * unscrolled depth is measured. */
  const SCROLL_MEASURE_DELAY_MS = 1000;
  /** Where a keyboard-activated click is anchored inside its element. */
  const ELEMENT_CENTER = 0.5;
  /** Names the element that scrolls the page, where the document does not. */
  const SCROLL_ROOT_ATTRIBUTE = "data-marketing-scroll-root";
  /** Share of the window an inner scroll container must cover to stand for
   * the page: less is a list, a code block or a dropdown. */
  const SCROLL_ROOT_COVERAGE = 0.5;
  /** Points of the window (fractions of its width and height) probed for an
   * inner scroll container: one covering most of the window holds several. */
  const SCROLL_ROOT_PROBES = [
    [0.5, 0.5],
    [0.5, 0.25],
    [0.5, 0.75],
    [0.25, 0.5],
    [0.75, 0.5],
  ];

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

  /** Read once and removed: the injected settings are not a page-facing API. */
  function servedConfig() {
    const injected = window[CONFIG_GLOBAL];
    delete window[CONFIG_GLOBAL];
    return injected && typeof injected === "object" ? injected : {};
  }

  const config = servedConfig();

  // Collection paused (Settings): the page API without the collection, so
  // `variation()` answers the control. A page already running the tracker
  // keeps it.
  if (config.paused === true) {
    window.dmsMarketing = window.dmsMarketing || NOOP_API;
    return;
  }

  const script = document.currentScript;
  if (!script) {
    return;
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

  /** Null while the page removed it: nothing is collected meanwhile. */
  let websiteId = script.getAttribute("data-website-id");

  // A tag included twice (theme and tag manager) would count everything twice.
  if (window[INSTALLED_GLOBAL]) {
    console.warn("[dms-marketing] tracker included twice; ignoring the copy.");
    return;
  }
  window[INSTALLED_GLOBAL] = true;

  /** Global Privacy Control is the opt-out signal browsers ship now that DNT
   * is deprecated; both are honoured alike. */
  const respectDnt = script.getAttribute("data-do-not-track") !== "false";
  const optedOut =
    navigator.doNotTrack === "1" ||
    window.doNotTrack === "1" ||
    navigator.globalPrivacyControl === true;
  if (respectDnt && optedOut) {
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

  /** Patterns of `data-exclude-paths`, each a path starting with "/". */
  const excludedPaths = (script.getAttribute("data-exclude-paths") || "")
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.charAt(0) === "/");

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
    title: document.title.slice(0, MAX_TITLE_LENGTH) || undefined,
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
    // Attribute writes are synchronous; MutationObserver delivery is not.
    // Until retargeting completes, never put new events in the old queue.
    if (!websiteId || script.getAttribute("data-website-id") !== websiteId || pageExcluded) {
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

  // --- Excluded pages -------------------------------------------------------

  function withoutTrailingSlash(path) {
    return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
  }

  function pathMatches(pattern, path) {
    if (pattern.endsWith("/**")) {
      const base = pattern.slice(0, -3);
      return path === base || path.startsWith(`${base}/`);
    }
    if (pattern.endsWith("/*")) {
      const base = pattern.slice(0, -2);
      const rest = path.startsWith(`${base}/`)
        ? path.slice(base.length + 1)
        : "";
      return rest !== "" && rest.indexOf("/") < 0;
    }
    return path === withoutTrailingSlash(pattern);
  }

  function isExcludedPath(pathname) {
    const path = withoutTrailingSlash(pathname);
    return excludedPaths.some((pattern) => pathMatches(pattern, path));
  }

  // --- Pageviews (initial + SPA navigations) --------------------------------

  let lastPath = null;
  /** The page on screen matches `data-exclude-paths`: nothing it does is
   * sent, its clicks and scroll depth included. */
  let pageExcluded = false;
  /** URL the scroll depth is being measured against — kept because a SPA
   * navigation rewrites `location` before the depth of the page being left
   * is flushed. */
  let scrolledUrl = null;
  /** -1 until the page has been measured once. */
  let maxScrollDepth = -1;

  function trackPageview() {
    if (location.pathname === lastPath) {
      return;
    }
    flushScrollDepth();
    lastPath = location.pathname;
    pageExcluded = isExcludedPath(lastPath);
    scrolledUrl = currentUrl();
    maxScrollDepth = -1;
    if (!websiteId || pageExcluded) {
      return;
    }
    // The rate it applies, for the server's "recorded on N % of page loads":
    // counting scroll events against pageviews undercounts the views left
    // before their depth is sent.
    enqueue(
      Object.assign(base(), { kind: "pageview", data: { sample: sampleRate } }),
    );
    scheduleScrollMeasure();
    scheduleSnapshot();
  }

  /** pushState and replaceState (a client-side redirect lands on a page
   * too); a same-path call — a query or hash update — is no navigation. */
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function navigate(...args) {
      original.apply(this, args);
      trackPageview();
    };
  }
  window.addEventListener("popstate", trackPageview);
  // A page restored from the back/forward cache runs no script again.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      lastPath = null;
      trackPageview();
    }
  });

  // --- Scroll root (see the header) ----------------------------------------

  function documentScrolls() {
    const root = document.documentElement;
    return root.scrollHeight - root.clientHeight > 1;
  }

  function scrollsVertically(element) {
    if (element.scrollHeight - element.clientHeight <= 1) {
      return false;
    }
    const overflow = getComputedStyle(element).overflowY;
    return overflow === "auto" || overflow === "scroll";
  }

  /** Area of the element's box inside the window. */
  function visibleArea(element) {
    const box = element.getBoundingClientRect();
    const width = Math.min(box.right, innerWidth) - Math.max(box.left, 0);
    const height = Math.min(box.bottom, innerHeight) - Math.max(box.top, 0);
    return width > 0 && height > 0 ? width * height : 0;
  }

  /**
   * The element scrolling the page, or null when it is the document. Found
   * from what lies under a few points of the window, never by walking the
   * whole tree: a container covering most of the window holds them.
   */
  function findScrollRoot() {
    if (documentScrolls()) {
      return null;
    }
    const marked = document.querySelector(`[${SCROLL_ROOT_ATTRIBUTE}]`);
    if (marked) {
      return marked;
    }
    if (typeof document.elementFromPoint !== "function") {
      return null;
    }
    const visited = new Set();
    let best = null;
    let bestArea = innerWidth * innerHeight * SCROLL_ROOT_COVERAGE;
    for (const [fx, fy] of SCROLL_ROOT_PROBES) {
      let node = document.elementFromPoint(innerWidth * fx, innerHeight * fy);
      // An ancestor already visited was checked with all of its own.
      for (; node && !visited.has(node); node = node.parentElement) {
        visited.add(node);
        if (
          node === document.body ||
          node === document.documentElement ||
          !scrollsVertically(node)
        ) {
          continue;
        }
        const area = visibleArea(node);
        if (area > bestArea) {
          best = node;
          bestArea = area;
        }
      }
    }
    return best;
  }

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

  function measureScrollDepth() {
    const depth = currentScrollDepth();
    if (depth > maxScrollDepth) {
      maxScrollDepth = depth;
    }
  }

  window.addEventListener("scroll", measureScrollDepth, { passive: true });

  /**
   * Every sampled view reports a depth, scrolled or not: what shows without
   * scrolling is reached too (all of a page shorter than the window), and a
   * view that never scrolls belongs in the denominator.
   */
  function scheduleScrollMeasure() {
    if (document.readyState === "complete") {
      setTimeout(measureScrollDepth, SCROLL_MEASURE_DELAY_MS);
      return;
    }
    window.addEventListener("load", measureScrollDepth, { once: true });
  }

  function flushScrollDepth() {
    if (!heatmapSampled || maxScrollDepth < 0) {
      return;
    }
    enqueue(
      Object.assign(base(), {
        kind: "scroll",
        url: scrolledUrl || currentUrl(),
        data: { depth: maxScrollDepth },
      }),
    );
    maxScrollDepth = -1;
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

  function rounded(value) {
    return Number(
      Math.min(Math.max(value, 0), 1).toFixed(COORDINATE_PRECISION),
    );
  }

  function normalized(value, total) {
    return total <= 0 ? 0 : rounded(value / total);
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
  function elementAnchor(target, point) {
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
      ox: rounded((point.clientX - box.left) / box.width),
      oy: rounded((point.clientY - box.top) / box.height),
      nth: nth,
    };
  }

  /**
   * Where the click happened. A click from the keyboard (Enter, Space) has no
   * pointer — detail 0, coordinates 0,0 — and is placed at the centre of the
   * element it activated instead of the window's corner.
   */
  function clickPoint(target, event) {
    if (event.detail !== 0 || event.clientX !== 0 || event.clientY !== 0) {
      return event;
    }
    const box = target.getBoundingClientRect();
    const clientX = box.left + box.width * ELEMENT_CENTER;
    const clientY = box.top + box.height * ELEMENT_CENTER;
    return {
      clientX: clientX,
      clientY: clientY,
      pageX: clientX + scrollX,
      pageY: clientY + scrollY,
    };
  }

  document.addEventListener(
    "click",
    (event) => {
      // Script-dispatched clicks (element.click()) are no visitor's.
      if (!heatmapSampled || !event.isTrusted) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const doc = document.documentElement;
      const point = clickPoint(target, event);
      enqueue(
        Object.assign(base(), {
          kind: "click",
          data: Object.assign(
            {
              x: normalized(point.clientX, innerWidth),
              y: normalized(point.clientY, innerHeight),
              dx: normalized(point.pageX, doc.scrollWidth),
              dy: normalized(point.pageY, doc.scrollHeight),
              selector: shortSelector(target),
            },
            elementAnchor(target, point),
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
      !websiteId ||
      script.getAttribute("data-website-id") !== websiteId ||
      pageExcluded ||
      snapshotsRequested >= MAX_SNAPSHOTS_PER_LOAD ||
      window.top !== window ||
      document.visibilityState !== "visible" ||
      innerWidth <= 0
    ) {
      return;
    }
    snapshotsRequested++;
    // The upload is only accepted for the page the visit's last pageview
    // named: that pageview must be on its way before the capture is.
    flush();
    const path = location.pathname;
    window[SNAPSHOT_CONTEXT_GLOBAL] = {
      website: websiteId,
      endpoint: snapshotEndpoint,
      path: path,
      // Looked for at capture time, the page as it is then.
      scrollRoot: findScrollRoot,
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
      enqueue(
        Object.assign(base(), {
          kind: "custom",
          name:
            typeof name === "string"
              ? name.slice(0, MAX_EVENT_NAME_LENGTH)
              : name,
          data,
        }),
      );
    },
    /** Assigned variation of a running experiment, or null. Reports the
     * exposure, so only call it where the variation is actually applied. */
    variation(experiment) {
      const requestedWebsite = websiteId;
      if (!requestedWebsite || script.getAttribute("data-website-id") !== requestedWebsite) {
        return Promise.resolve(null);
      }
      return loadAssignments().then((assignments) => {
        if (websiteId !== requestedWebsite || script.getAttribute("data-website-id") !== requestedWebsite) {
          return null;
        }
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

  /**
   * The tag's website changed: what was collected so far leaves under the
   * previous one, and the page on screen counts for the new one. The
   * assignments were the previous website's experiments.
   */
  function followWebsiteId() {
    const next = script.getAttribute("data-website-id") || null;
    if (next === websiteId) {
      return;
    }
    flushScrollDepth();
    flush();
    websiteId = next;
    assignmentsPromise = null;
    exposedExperiments.clear();
    lastPath = null;
    trackPageview();
  }

  if (typeof MutationObserver === "function") {
    new MutationObserver(followWebsiteId).observe(script, {
      attributes: true,
      attributeFilter: ["data-website-id"],
    });
  }

  trackPageview();
})();
