const { EnsureWebsite } = require("@antelopejs/interface-dms-marketing");
const { GetModel } = require("@antelopejs/interface-database-decorators");
const { MarketingEventsModel, WebsitesModel } = require("../../dist/db");
const {
  ingestPreparedBatch,
  prepareEvents,
} = require("../../dist/services/collect");

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const ORIGIN = "https://trails.example";
/** Two days back, on a minute: inside every retention, and in the past. */
const T0 = Math.floor((Date.now() - 2 * DAY) / MINUTE) * MINUTE;
/** The history copy of a session runs this much later than its live copy. */
const HISTORY_SHIFT_MS = 250;

/** @param {number} minutes */
const at = (minutes) => T0 + Math.round(minutes * MINUTE);

/**
 * @typedef {{ kind: "pageview" | "custom" | "exposure", path: string, name?: string, data?: Record<string, unknown>, at?: number }} FixtureEvent
 * @typedef {{ at: number, events: FixtureEvent[] }} FixtureBatch
 * @typedef {{ name: string, batches: FixtureBatch[] }} FixtureSession
 */

/**
 * @param {string} path
 * @param {number} [minute]
 * @returns {FixtureEvent}
 */
const page = (path, minute) => ({
  kind: "pageview",
  path,
  at: minute === undefined ? undefined : at(minute),
});

/**
 * @param {string} name
 * @param {number} [minute]
 * @returns {FixtureEvent}
 */
const custom = (name, minute) => ({
  kind: "custom",
  path: "/",
  name,
  at: minute === undefined ? undefined : at(minute),
});

/**
 * @param {string} variation
 * @param {number} minute
 * @param {string} [experiment]
 * @returns {FixtureEvent}
 */
const exposure = (variation, minute, experiment = "hero") => ({
  kind: "exposure",
  path: "/landing",
  name: experiment,
  data: { experiment, variation },
  at: at(minute),
});

/**
 * One beacon per event, each at its own time.
 * @param {FixtureEvent[]} events
 * @returns {FixtureBatch[]}
 */
const beacons = (events) =>
  events.map((event) => ({ at: event.at ?? T0, events: [event] }));

/**
 * One batch whose events carry no clock: all of them share its instant.
 * @param {number} minute
 * @param {FixtureEvent[]} events
 * @returns {FixtureBatch}
 */
const tie = (minute, events) => ({ at: at(minute), events });

/**
 * A visit of a split: a landing pageview opens it, then its events.
 * @param {string} name
 * @param {number} minute
 * @param {FixtureEvent[]} events
 * @returns {FixtureSession}
 */
const visit = (name, minute, events) => ({
  name,
  batches: beacons([page("/landing", minute), ...events]),
});

/**
 * Every rule the read has. Gaps inside a session stay under the 30-minute
 * idle timeout, so each live copy stays one session; `/x` pageviews keep long
 * visits alive.
 * @type {FixtureSession[]}
 */
const SESSIONS = [
  {
    name: "templates-first",
    batches: beacons([page("/zeta", -30), custom("subscribe", -29)]),
  },
  {
    name: "templates-second",
    batches: beacons([page("/alpha", -28), custom("subscribe", -27)]),
  },
  {
    name: "templates-leading",
    batches: [tie(-26, [custom("subscribe"), page("/omega")])],
  },
  { name: "skip", batches: beacons([page("/a", 0), page("/c", 2)]) },
  {
    name: "repeat",
    batches: beacons([
      page("/a", 4),
      page("/a", 5),
      page("/b", 6),
      page("/b", 7),
      page("/c", 8),
    ]),
  },
  {
    name: "reorder",
    batches: beacons([
      page("/b", 10),
      page("/a", 11),
      page("/c", 12),
      page("/a", 13),
      page("/b", 14),
    ]),
  },
  {
    name: "tie-whole",
    batches: [tie(16, [page("/shop/x"), custom("signup"), page("/pricing")])],
  },
  {
    name: "tie-reversed",
    batches: [
      ...beacons([page("/shop/y", 18)]),
      tie(19, [page("/pricing"), custom("signup")]),
    ],
  },
  {
    name: "tie-ordered",
    batches: [
      ...beacons([page("/shop/z", 20)]),
      tie(21, [custom("signup"), page("/pricing")]),
    ],
  },
  {
    name: "out-of-order",
    batches: beacons([page("/b", 25), page("/a", 23), page("/c", 27)]),
  },
  {
    name: "straddles-since",
    batches: beacons([page("/a", 40), page("/b", 50), page("/c", 55)]),
  },
  {
    name: "past-conversion-window",
    batches: beacons([
      page("/a", 60),
      page("/b", 80),
      page("/x", 100),
      page("/c", 121),
    ]),
  },
  {
    name: "at-conversion-window",
    batches: beacons([
      page("/a", 62),
      page("/b", 70),
      page("/x", 95),
      page("/c", 122),
    ]),
  },
  {
    name: "straddles-until",
    batches: beacons([page("/a", 130), page("/b", 135), page("/c", 145)]),
  },
  visit("before-run", 190, [
    exposure("control", 190),
    page("/a", 191),
    custom("buy", 192),
  ]),
  visit("control", 201, [
    exposure("control", 201),
    page("/a", 202),
    custom("buy", 203),
  ]),
  visit("bold", 205, [exposure("bold", 205), page("/a", 206)]),
  visit("bold-converts", 210, [
    exposure("bold", 210),
    page("/a", 211),
    custom("buy", 215),
  ]),
  visit("mixed", 220, [
    exposure("control", 220),
    exposure("bold", 225),
    page("/a", 226),
    custom("buy", 227),
  ]),
  visit("no-arm", 230, [exposure("other", 230), page("/a", 231)]),
  visit("other-split", 232, [
    exposure("control", 232, "other-split"),
    page("/a", 233),
    custom("buy", 234),
  ]),
  visit("exposed-only", 240, [exposure("control", 240)]),
  visit("exposed-twice", 242, [
    exposure("bold", 242),
    exposure("bold", 243),
    page("/a", 244),
  ]),
  visit("first-run-stop", 260, [
    exposure("control", 260),
    page("/a", 261),
    custom("buy", 262),
  ]),
  visit("paused", 290, [
    exposure("bold", 290),
    page("/x", 305),
    exposure("control", 321),
    page("/a", 322),
    custom("buy", 330),
  ]),
  visit("second-run-start", 320, [
    exposure("bold", 320),
    page("/a", 323),
    custom("buy", 324),
  ]),
  visit("past-tail", 378, [
    exposure("control", 378),
    page("/a", 395),
    page("/x", 420),
    custom("buy", 442),
  ]),
  visit("tail", 379, [
    exposure("bold", 379),
    page("/a", 381),
    page("/x", 405),
    custom("buy", 430),
  ]),
];

/**
 * Raw rows no tracker sends today: an exposure without data, a variation that
 * is not a string, a custom event without a name.
 * @type {FixtureSession}
 */
const ODD_HISTORY = {
  name: "odd",
  batches: beacons([
    page("/landing", 245),
    { kind: "exposure", path: "/landing", name: "hero", at: at(246) },
    {
      kind: "exposure",
      path: "/landing",
      name: "hero",
      data: { experiment: "hero", variation: 42 },
      at: at(247),
    },
    { kind: "custom", path: "/", at: at(248) },
  ]),
};

const GOAL = [
  { kind: "url", value: "/a" },
  { kind: "custom", value: "buy" },
];
const FIRST_RUN = { startedAt: at(200), stoppedAt: at(260) };
const ARMS = [
  { key: "control", weight: 1 },
  { key: "bold", weight: 1 },
];

/** @param {string} websiteId */
function funnelsOf(websiteId) {
  /**
   * @param {string} name
   * @param {import("../../dist/db").FunnelStep[]} steps
   * @param {number} conversionWindowMs
   * @param {import("../../dist/db").FunnelExperiment | null} [experiment]
   */
  const funnel = (name, steps, conversionWindowMs, experiment = null) => ({
    name,
    websiteId,
    steps,
    conversionWindowMs,
    experiment,
  });
  return [
    funnel(
      "pages",
      [
        { kind: "url", value: "/a" },
        { kind: "url", value: "/b" },
        { kind: "url", value: "/c" },
      ],
      60 * MINUTE,
    ),
    funnel(
      "prefix and event",
      [
        { kind: "url", value: "/shop/*" },
        { kind: "custom", value: "signup" },
        { kind: "url", value: "/pricing" },
      ],
      DAY,
    ),
    funnel("stopped split", GOAL, 60 * MINUTE, {
      key: "hero",
      status: "stopped",
      variations: ARMS,
      runs: [FIRST_RUN, { startedAt: at(320), stoppedAt: at(380) }],
    }),
    funnel("running split", GOAL, 60 * MINUTE, {
      key: "hero",
      status: "running",
      variations: ARMS,
      runs: [FIRST_RUN, { startedAt: at(320), stoppedAt: null }],
    }),
    funnel("draft split", GOAL, 60 * MINUTE, {
      key: "hero",
      status: "draft",
      variations: ARMS,
      runs: [],
    }),
    funnel("no steps", [], 60 * MINUTE),
  ];
}

const WINDOWS = [
  {
    name: "the whole fixture",
    since: new Date(at(-60)),
    until: new Date(at(900)),
  },
  {
    name: "a window cutting at since",
    since: new Date(at(45)),
    until: new Date(at(900)),
  },
  {
    name: "a window cutting at until",
    since: new Date(at(-60)),
    until: new Date(at(140)),
  },
];

/**
 * @param {import("../../dist/db").Website} website
 * @param {string} visitor
 * @param {FixtureBatch} batch
 */
async function ingestBatch(website, visitor, batch) {
  const outcome = await ingestPreparedBatch(
    website,
    prepareEvents(
      website._id,
      batch.events.map((event) => ({
        kind: event.kind,
        url: ORIGIN + event.path,
        name: event.name,
        data: event.data,
        at: event.at,
      })),
    ),
    {
      visitorId: `${website._id}-${visitor}`,
      now: new Date(batch.at),
      device: {},
      trustTimestamps: true,
    },
  );
  await outcome?.rollup;
}

/**
 * @param {import("../../dist/db").Website} website
 * @param {FixtureSession} session
 */
async function ingestLive(website, session) {
  for (const batch of session.batches) {
    await ingestBatch(website, session.name, batch);
  }
}

/**
 * A second wave of live traffic, every beacon sent at once: two tabs of one
 * visit racing, and a visit whose batches arrive out of order.
 * @param {import("../../dist/db").Website} website
 */
async function ingestWave(website) {
  const racing = beacons([page("/a", 460), page("/b", 461), page("/c", 462)]);
  const late = beacons([page("/a", 470), page("/c", 472), page("/b", 471)]);
  await ingestBatch(website, "wave-racing", racing[0]);
  await ingestBatch(website, "wave-late", late[0]);
  await Promise.all([
    ...racing
      .slice(1)
      .map((batch) => ingestBatch(website, "wave-racing", batch)),
    ...late.slice(1).map((batch) => ingestBatch(website, "wave-late", batch)),
  ]);
}

/** Sessions of raw history added to the full fixture, past one flush of the backfill. */
const FILLER_SESSIONS = 1700;

/**
 * History newer than the rest of the fixture, one batch of three events
 * sharing a timestamp per session: more events than one flush of the
 * backfill, so the flush boundary falls inside a batch.
 * @param {import("../../dist/db").Website} website
 */
async function insertFiller(website) {
  const rows = [];
  for (let index = 0; index < FILLER_SESSIONS; index++) {
    const timestamp = new Date(at(600) + index * 10_000);
    const sessionId = `${website._id}-filler-${index}`;
    for (const event of [
      page(`/shop/${index % 7}`),
      custom("signup"),
      page("/pricing"),
    ]) {
      rows.push({
        websiteId: website._id,
        timestamp,
        day: Math.floor(timestamp.getTime() / DAY) * DAY,
        kind: event.kind,
        sessionId,
        visitorId: `${sessionId}-visitor`,
        url: event.path,
        name: event.name,
      });
    }
  }
  await GetModel(MarketingEventsModel, website.tenantId).insertMany(rows);
}

/**
 * Rows written straight to the events table: history from before the trails.
 * @param {import("../../dist/db").Website} website
 * @param {FixtureSession} session
 * @param {number} shift
 */
async function insertHistory(website, session, shift) {
  const sessionId = `${website._id}-${session.name}-history`;
  for (const batch of session.batches) {
    await GetModel(MarketingEventsModel, website.tenantId).insertMany(
      batch.events.map((event) => {
        const timestamp = new Date((event.at ?? batch.at) + shift);
        return {
          websiteId: website._id,
          timestamp,
          day: Math.floor(timestamp.getTime() / DAY) * DAY,
          kind: event.kind,
          sessionId,
          visitorId: `${sessionId}-visitor`,
          url: event.path,
          name: event.name,
          data: event.data,
        };
      }),
    );
  }
}

/**
 * A website of `tenantId` holding every fixture session twice: once through
 * live ingestion, once as rows inserted straight into the events table. With
 * `history` false, only the live copies.
 * @param {string} tenantId
 * @param {string} websiteId
 * @param {boolean} [history]
 */
async function seedFixture(tenantId, websiteId, history = true) {
  await EnsureWebsite({
    id: websiteId,
    tenantId,
    name: websiteId,
    domain: `${websiteId}.example`,
  });
  const website = await GetModel(WebsitesModel).get(websiteId);
  if (!website) {
    throw new Error(`website ${websiteId} was not created`);
  }
  for (const session of SESSIONS) {
    await ingestLive(website, session);
    if (history) {
      await insertHistory(website, session, HISTORY_SHIFT_MS);
    }
  }
  if (history) {
    await insertHistory(website, ODD_HISTORY, 0);
    await insertFiller(website);
  }
  return { website, funnels: funnelsOf(websiteId) };
}

module.exports = { WINDOWS, at, ingestWave, seedFixture };
