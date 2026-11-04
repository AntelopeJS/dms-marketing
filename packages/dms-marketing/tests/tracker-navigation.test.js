const assert = require("node:assert/strict");
const vm = require("node:vm");
const { TRACKER_SOURCE, parseBeacon } = require("./helpers/tracker");
const test = it;
const { dashboardExcludedPaths } = require("../dist/frontend-module");

const ORIGIN = "https://dms.example.com";

/**
 * @typedef {object} SentEvent
 * @property {string} website
 * @property {string} kind
 * @property {string} path
 */

/**
 * @typedef {object} TrackerApi
 * @property {(name: string) => void} track
 */

/** @typedef {import("./helpers/tracker").Beacon} Beacon */

/**
 * Runs the static/tracker script against a stand-in browser: History API, beacons
 * and the tag's attributes, enough to follow pageviews across navigations.
 * Heatmap sampling is off, so the beacons carry pageviews and custom events.
 * @param {Record<string, string>} attributes
 * @param {string} pathname
 */
function loadTracker(attributes, pathname) {
  const attrs = new Map(
    Object.entries({ "data-heatmap-sample": "0", ...attributes }),
  );
  /** @type {Map<string, Array<() => void>>} */
  const listeners = new Map();
  /** @type {Beacon[]} */
  const beacons = [];
  let observer = () => {};
  const location = { origin: ORIGIN, pathname, search: "" };
  /** @param {string} url */
  const navigateTo = (url) => {
    location.pathname = url;
  };
  const context = {
    console,
    URL,
    setTimeout: () => 0,
    clearTimeout: () => {},
    location,
    /** @type {TrackerApi | undefined} */
    dmsMarketing: undefined,
    history: {
      /**
       * @param {unknown} _s
       * @param {unknown} _t
       * @param {string} url
       */
      pushState: (_s, _t, url) => navigateTo(url),
      /**
       * @param {unknown} _s
       * @param {unknown} _t
       * @param {string} url
       */
      replaceState: (_s, _t, url) => navigateTo(url),
    },
    screen: { width: 1280, height: 800 },
    navigator: {
      language: "en-GB",
      /**
       * @param {string} _url
       * @param {{ body: string }} blob
       */
      sendBeacon(_url, blob) {
        beacons.push(parseBeacon(blob.body));
        return true;
      },
    },
    document: {
      currentScript: {
        src: `${ORIGIN}/api/marketing/tracker.js`,
        /** @param {string} name */
        getAttribute: (name) => attrs.get(name) ?? null,
      },
      referrer: "",
      title: "Dashboard",
      readyState: "loading",
      visibilityState: "visible",
      addEventListener() {},
    },
    Blob: class {
      /** @param {string[]} parts */
      constructor(parts) {
        this.body = parts.join("");
      }
    },
    MutationObserver: class {
      /** @param {() => void} callback */
      constructor(callback) {
        observer = callback;
      }
      observe() {}
    },
    /**
     * @param {string} type
     * @param {() => void} listener
     */
    addEventListener(type, listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  context.window = context;
  vm.runInNewContext(TRACKER_SOURCE, context);
  return {
    /** @param {string} url */
    navigate: (url) => context.history.pushState(null, "", url),
    /** @param {string} name */
    track: (name) => context.dmsMarketing.track(name),
    /** @param {string | null} id */
    setWebsite(id) {
      if (id === null) {
        attrs.delete("data-website-id");
      } else {
        attrs.set("data-website-id", id);
      }
      queueMicrotask(observer);
    },
    /**
     * Everything sent so far, flushed as on leaving the page.
     * @returns {SentEvent[]}
     */
    sent() {
      for (const listener of listeners.get("pagehide") ?? []) {
        listener();
      }
      return beacons.flatMap((beacon) =>
        beacon.events.map((event) => ({
          website: beacon.website,
          kind: event.kind,
          path: new URL(event.url).pathname,
        })),
      );
    },
  };
}

/**
 * @param {SentEvent[]} events
 * @returns {string[]}
 */
function pageviews(events) {
  return events
    .filter((event) => event.kind === "pageview")
    .map((event) => `${event.website} ${event.path}`);
}

test("SPA navigations are counted as pageviews", () => {
  const tracker = loadTracker(
    { "data-website-id": "site" },
    "/modules/marketing/overview",
  );
  tracker.navigate("/modules/crm/customers");
  tracker.navigate("/modules/crm/customers");
  tracker.navigate("/modules/marketing/overview");
  assert.deepEqual(pageviews(tracker.sent()), [
    "site /modules/marketing/overview",
    "site /modules/crm/customers",
    "site /modules/marketing/overview",
  ]);
});

test("excluded paths send nothing, custom events included", () => {
  const tracker = loadTracker(
    {
      "data-website-id": "site",
      "data-exclude-paths": "/auth/**, /settings/*",
    },
    "/auth/login",
  );
  tracker.track("on-login");
  tracker.navigate("/home");
  tracker.navigate("/settings/profile");
  tracker.track("on-settings");
  tracker.navigate("/settings/profile/security");
  tracker.navigate("/auth");
  tracker.navigate("/auth/");
  tracker.navigate("/settings");
  const sent = tracker.sent();
  assert.deepEqual(pageviews(sent), [
    "site /home",
    "site /settings/profile/security",
    "site /settings",
  ]);
  assert.equal(
    sent.some((event) => event.kind === "custom"),
    false,
  );
});

test("the dashboard's tag sends nothing from the module area", () => {
  const patterns = dashboardExcludedPaths({
    enabled: true,
    websiteName: "Dashboard",
    excludePaths: [],
    snapshots: false,
  });
  const tracker = loadTracker(
    { "data-website-id": "site", "data-exclude-paths": patterns.join(",") },
    "/modules",
  );
  tracker.track("on-modules");
  tracker.navigate("/modules/store");
  tracker.navigate("/modules/crm/customers");
  tracker.track("on-a-module");
  tracker.navigate("/modules/");
  tracker.navigate("/orders");
  tracker.navigate("/modulesx");
  const sent = tracker.sent();
  assert.deepEqual(pageviews(sent), ["site /orders", "site /modulesx"]);
  assert.equal(
    sent.some((event) => event.kind === "custom"),
    false,
  );
});

test("the tag's website id is followed: paused, then retargeted", async () => {
  const tracker = loadTracker({ "data-website-id": "site-a" }, "/a");
  tracker.track("before-sign-out");
  tracker.setWebsite(null);
  tracker.navigate("/auth");
  tracker.navigate("/b");
  tracker.track("while-paused");
  tracker.setWebsite("site-b");
  await Promise.resolve();
  tracker.navigate("/c");
  const sent = tracker.sent();
  assert.deepEqual(pageviews(sent), ["site-a /a", "site-b /b", "site-b /c"]);
  assert.deepEqual(
    sent
      .filter((event) => event.kind === "custom")
      .map((event) => `${event.website} ${event.path}`),
    ["site-a /a"],
  );
});

test("a pause takes effect before mutation delivery and a tag can start paused", async () => {
  const tracker = loadTracker({ "data-website-id": "site-a" }, "/a");
  tracker.setWebsite(null);
  tracker.navigate("/workspace-b/private");
  tracker.track("while-paused");
  await Promise.resolve();
  assert.deepEqual(pageviews(tracker.sent()), ["site-a /a"]);
  const paused = loadTracker({}, "/start");
  paused.setWebsite("site-b");
  await Promise.resolve();
  assert.deepEqual(pageviews(paused.sent()), ["site-b /start"]);
});
