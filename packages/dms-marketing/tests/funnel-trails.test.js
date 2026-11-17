const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const { GetModel } = require("@antelopejs/interface-database-decorators");
const {
  FunnelTrailBackfillsModel,
  FunnelTrailsModel,
  MarketingEventsModel,
} = require("../dist/db");
const {
  backfillAllTenants,
  funnelResultsIn,
  funnelTemplates,
} = require("../dist/services/funnels");
const {
  WINDOWS,
  at,
  ingestWave,
  seedFixture,
} = require("./helpers/funnel-fixture");
const {
  referenceFunnelResults,
  referenceTemplates,
} = require("./helpers/raw-funnel-reference");

const TENANT = "funnel-trails";

/** @typedef {Awaited<ReturnType<typeof seedFixture>>} Fixture */
/** @typedef {Fixture["funnels"][number]} FixtureFunnel */
/** @typedef {(typeof WINDOWS)[number]} FixtureWindow */

/** Every session written live and again as raw history. */
/** @type {Fixture} */
let fixture;
/** The live copies alone, on a website of their own. */
/** @type {Fixture} */
let live;

function events() {
  return GetModel(MarketingEventsModel, TENANT);
}

/**
 * @param {Fixture} site
 * @param {string} name
 */
function funnelNamed(site, name) {
  const funnel = site.funnels.find((candidate) => candidate.name === name);
  if (!funnel) {
    throw new Error(`no fixture funnel named ${name}`);
  }
  return funnel;
}

/**
 * Every funnel over every window, and the templates, against the frozen raw
 * read: a complete read, and the same answer.
 * @param {Fixture} site
 */
async function assertSameAsReference(site) {
  for (const funnel of site.funnels) {
    for (const window of WINDOWS) {
      const { incomplete, ...results } = await funnelResultsIn(
        funnel,
        TENANT,
        window,
      );
      const label = `${funnel.name} over ${window.name}`;
      assert.equal(incomplete, false, label);
      assert.deepEqual(
        results,
        await referenceFunnelResults(events(), funnel, window),
        label,
      );
    }
  }
  for (const window of WINDOWS) {
    assert.deepEqual(
      await funnelTemplates(site.website, window),
      await referenceTemplates(events(), site.website, window),
      `templates over ${window.name}`,
    );
  }
}

/** One backfill pass that reports no failure. */
async function backfill() {
  /** @type {Error[]} */
  const failures = [];
  await backfillAllTenants((failure) => failures.push(failure));
  assert.deepEqual(failures, []);
}

/**
 * Per session of the site, how many events its trail holds.
 * @param {Fixture} site
 */
async function trailSizes(site) {
  /** @type {Record<string, number>} */
  const sizes = {};
  for await (const session of GetModel(FunnelTrailsModel, TENANT).sessionsIn({
    websiteId: site.website._id,
    since: 0,
    until: Number.MAX_SAFE_INTEGER,
    withExposures: true,
  })) {
    sizes[session.sessionId] = session.events.length;
  }
  return sizes;
}

/**
 * The backfill's flushes write session by session, and the second flush of
 * `websiteId` stops after half of its sessions, as a crash would leave it.
 * @param {string} websiteId
 */
function stopSecondFlushHalfWay(websiteId) {
  let flushes = 0;
  mock.method(
    FunnelTrailsModel.prototype,
    "recordMany",
    /**
     * @this {InstanceType<typeof FunnelTrailsModel>}
     * @param {string} site
     * @param {Map<string, import("../dist/db").TrailedEvent[]>} sessions
     */
    async function (site, sessions) {
      const stops = site === websiteId && ++flushes === 2;
      const written = stops
        ? [...sessions].slice(0, Math.floor(sessions.size / 2))
        : [...sessions];
      for (const [sessionId, events] of written) {
        await this.record(site, sessionId, events);
      }
      if (stops) {
        throw new Error("the flush stopped half-way");
      }
    },
  );
}

describe("funnel results over sessions that skip, repeat and reorder steps", () => {
  before(async function () {
    this.timeout(60_000);
    fixture = await seedFixture(TENANT, "funnel-trails-site");
    live = await seedFixture(TENANT, "funnel-trails-live", false);
  });

  test("the fixture reads as counted by hand", async () => {
    const [whole] = WINDOWS;
    const pages = await funnelResultsIn(
      funnelNamed(live, "pages"),
      TENANT,
      whole,
    );
    assert.deepEqual(
      pages.computation.steps.map((step) => step.sessions),
      [21, 7, 5],
    );
    const ordered = await funnelResultsIn(
      funnelNamed(live, "prefix and event"),
      TENANT,
      whole,
    );
    assert.deepEqual(
      ordered.computation.steps.map((step) => step.sessions),
      [3, 3, 2],
    );
    const split = await funnelResultsIn(
      funnelNamed(live, "stopped split"),
      TENANT,
      whole,
    );
    assert.deepEqual(
      split.experiment?.variations.map((arm) => [
        arm.key,
        arm.exposedSessions,
        arm.conversions,
      ]),
      [
        ["control", 5, 3],
        ["bold", 5, 3],
      ],
    );
    assert.deepEqual(await funnelTemplates(live.website, whole), [
      {
        steps: [
          { kind: "url", value: "/landing" },
          { kind: "custom", value: "buy" },
        ],
        entering: 14,
      },
      {
        steps: [
          { kind: "url", value: "/zeta" },
          { kind: "custom", value: "subscribe" },
        ],
        entering: 1,
      },
    ]);
  });

  test("before the backfill a read over history says it is incomplete", async () => {
    for (const funnel of fixture.funnels) {
      const results = await funnelResultsIn(funnel, TENANT, WINDOWS[0]);
      assert.equal(results.incomplete, true, funnel.name);
    }
  });

  test("a backfill stopped in its second flush resumes to the raw read", async function () {
    this.timeout(30_000);
    stopSecondFlushHalfWay(fixture.website._id);
    /** @type {string[]} */
    const failures = [];
    await backfillAllTenants((failure) => failures.push(failure.message));
    mock.restoreAll();
    assert.deepEqual(failures, ["the flush stopped half-way"]);
    const newest = { since: new Date(at(700)), until: new Date(at(900)) };
    const ordered = funnelNamed(fixture, "prefix and event");
    assert.equal(
      (await funnelResultsIn(ordered, TENANT, newest)).incomplete,
      false,
    );
    assert.equal(
      (await funnelResultsIn(ordered, TENANT, WINDOWS[0])).incomplete,
      true,
    );
    await backfill();
    await assertSameAsReference(fixture);
    await assertSameAsReference(live);
  });

  test("a second backfill adds nothing", async () => {
    const before = await trailSizes(fixture);
    const raw = await events().queryRange({
      websiteIds: [fixture.website._id],
      since: new Date(0),
      until: new Date(Date.now()),
      kinds: ["pageview", "custom", "exposure"],
      limit: Number.MAX_SAFE_INTEGER,
      fields: [],
    });
    assert.equal(
      Object.values(before).reduce((sum, size) => sum + size, 0),
      raw.length,
    );
    await backfill();
    assert.deepEqual(await trailSizes(fixture), before);
  });

  test("live batches during a backfill still read as the raw read", async () => {
    await GetModel(FunnelTrailBackfillsModel, TENANT).deleteByWebsite(
      fixture.website._id,
    );
    await Promise.all([backfill(), ingestWave(fixture.website)]);
    await assertSameAsReference(fixture);
  });
});
