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
 * (static/snapshot/) or nothing — so a visit never serializes a page
 * nobody will keep, and a page is captured about once a day however busy
 * it is. Off unless the website opted in.
 *
 * Scroll root: an app shell often keeps its document still and scrolls an
 * inner container instead (a dashboard panel, a sidebar layout). When the
 * document does not scroll, the page's scroll root is the element marked
 * `data-marketing-scroll-root` if there is one, else the largest visible
 * element scrolling vertically (overflow-y auto or scroll, content taller
 * than its box) that covers most of the window; the document otherwise.
 * Scroll depth is measured on it, and click positions are taken in its
 * content, as if the page were unrolled — which is how a capture draws it.
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
    scrollRootElement = null;
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

