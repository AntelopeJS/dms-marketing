const assert = require("node:assert/strict");
const test = it;
const { GetModel } = require("@antelopejs/interface-database-decorators");
const { EnsureWebsite } = require("@antelopejs/interface-dms-marketing");
const { FunnelTrailsModel, WebsitesModel } = require("../dist/db");
const {
  ingestPreparedBatch,
  prepareEvents,
} = require("../dist/services/collect");
const { MAX_TRAIL_EVENTS } = require("../dist/types/constants");
const { useRealModels } = require("./helpers/funnel-trail-checks");

const TENANT = "funnel-trail-writes";
const DAY = 86_400_000;
const T0 = Date.now() - DAY;
const ALL_TIME = { since: 0, until: Date.now() + DAY };

/** @typedef {import("../dist/db").TrailedEvent} TrailedEvent */

let eventCount = 0;

/**
 * @param {number} at
 * @param {string} path
 * @param {string} [id]
 * @returns {TrailedEvent}
 */
function pageview(at, path, id) {
  eventCount += 1;
  return {
    _id: id ?? `pageview-${eventCount}`,
    kind: "pageview",
    timestamp: new Date(T0 + at),
    url: path,
  };
}

/**
 * @param {number} at
 * @param {string} name
 * @returns {TrailedEvent}
 */
function customEvent(at, name) {
  eventCount += 1;
  return {
    _id: `custom-${eventCount}`,
    kind: "custom",
    timestamp: new Date(T0 + at),
    url: "/",
    name,
  };
}

function trails() {
  return GetModel(FunnelTrailsModel, TENANT);
}

/**
 * Each session of the website, in a sorted list, as `sessionsIn` reads it.
 * @param {string} websiteId
 * @param {{ since: number, until: number, withExposures?: boolean }} [window]
 */
async function read(websiteId, window = ALL_TIME) {
  const sessions = [];
  for await (const session of trails().sessionsIn({
    websiteId,
    withExposures: true,
    ...window,
  })) {
    sessions.push(session);
  }
  return sessions.sort((a, b) => a.sessionId.localeCompare(b.sessionId));
}

/** @param {import("../dist/db").TrailEvent[]} events */
function labels(events) {
  return events.map((event) =>
    event.kind === "pageview" ? event.path : `${event.kind}:${event.name}`,
  );
}

describe("a session's funnel trail", () => {
  useRealModels();
  test("holds each event once, by time, ties in the order they were written", async () => {
    const replayed = [pageview(10, "/b", "replayed-b")];
    await trails().record("order-site", "order", replayed);
    await trails().record("order-site", "order", [
      pageview(5, "/a"),
      customEvent(5, "signup"),
      pageview(5, "/pricing"),
    ]);
    await trails().record("order-site", "order", replayed);
    await trails().record("order-site", "order", [
      { ...pageview(7, "/scrolled"), kind: "scroll" },
    ]);
    const [session] = await read("order-site");
    assert.deepEqual(labels(session.events), [
      "/a",
      "custom:signup",
      "/pricing",
      "/b",
    ]);
    assert.equal(session.overflowed, false);
  });

  test("keeps every batch of concurrent first writes", async () => {
    const batches = Array.from({ length: 12 }, (_, index) => [
      pageview(index, `/page-${index}`),
    ]);
    await Promise.all(
      batches.map((batch) => trails().record("race-site", "race", batch)),
    );
    const [session] = await read("race-site");
    assert.deepEqual(
      labels(session.events),
      batches.map((_, index) => `/page-${index}`),
    );
  });

  test("is cut at its cap, and says so", async () => {
    const full = Array.from({ length: MAX_TRAIL_EVENTS }, (_, index) =>
      pageview(index, "/feed"),
    );
    await trails().record("cap-site", "capped", full);
    let [session] = await read("cap-site");
    assert.equal(session.events.length, MAX_TRAIL_EVENTS);
    assert.equal(session.overflowed, false);
    await trails().record("cap-site", "capped", [
      full[0],
      pageview(MAX_TRAIL_EVENTS, "/late"),
    ]);
    [session] = await read("cap-site");
    assert.equal(session.events.length, MAX_TRAIL_EVENTS);
    assert.equal(session.overflowed, true);
    assert.equal(labels(session.events).includes("/late"), false);
  });

  test("reads only the window, and exposures only when asked", async () => {
    await trails().record("window-site", "window", [
      pageview(1, "/before"),
      pageview(2, "/inside"),
      {
        _id: "exposure-inside",
        kind: "exposure",
        timestamp: new Date(T0 + 2),
        url: "/inside",
        name: "hero",
        data: { experiment: "hero", variation: "bold" },
      },
      pageview(3, "/after"),
    ]);
    const window = { since: T0 + 2, until: T0 + 2 };
    const [split] = await read("window-site", window);
    assert.deepEqual(split.events, [
      { kind: "pageview", at: T0 + 2, path: "/inside" },
      {
        kind: "exposure",
        at: T0 + 2,
        experiment: "hero",
        variation: "bold",
      },
    ]);
    const [plain] = await read("window-site", {
      ...window,
      withExposures: false,
    });
    assert.deepEqual(labels(plain.events), ["/inside"]);
    assert.deepEqual(await read("window-site", { since: 0, until: T0 }), []);
  });
});

describe("a collect batch", () => {
  useRealModels();
  test("lands in its session's funnel trail", async () => {
    await EnsureWebsite({
      id: "live-site",
      tenantId: TENANT,
      name: "live-site",
      domain: "live.example",
    });
    const website = await GetModel(WebsitesModel).get("live-site");
    assert.ok(website);
    const outcome = await ingestPreparedBatch(
      website,
      prepareEvents(website._id, [
        { kind: "pageview", url: "https://live.example/pricing", at: T0 },
        {
          kind: "click",
          url: "https://live.example/pricing",
          at: T0,
          data: { x: 0.5, y: 0.5 },
        },
        {
          kind: "custom",
          url: "https://live.example/pricing",
          at: T0,
          name: "signup",
        },
      ]),
      {
        visitorId: "live-visitor",
        now: new Date(T0),
        device: {},
        trustTimestamps: true,
      },
    );
    await outcome?.rollup;
    const sessions = await read("live-site");
    assert.deepEqual(
      sessions.map((session) => labels(session.events)),
      [["/pricing", "custom:signup"]],
    );
  });
});
