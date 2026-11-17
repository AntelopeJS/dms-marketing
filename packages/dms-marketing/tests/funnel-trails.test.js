const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const { GetModel } = require("@antelopejs/interface-database-decorators");
const { FunnelTrailBackfillsModel, FunnelTrailsModel } = require("../dist/db");
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
  assertSameAsReference,
  backfill,
  rawFunnelEventCount,
  total,
  trailSizes,
} = require("./helpers/funnel-trail-checks");

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
    await assertSameAsReference(TENANT, fixture);
    await assertSameAsReference(TENANT, live);
  });

  test("a second backfill adds nothing", async () => {
    const before = await trailSizes(TENANT, fixture.website._id);
    assert.equal(
      total(before),
      await rawFunnelEventCount(TENANT, fixture.website._id),
    );
    await backfill();
    assert.deepEqual(await trailSizes(TENANT, fixture.website._id), before);
  });

  test("live batches during a backfill still read as the raw read", async () => {
    await GetModel(FunnelTrailBackfillsModel, TENANT).deleteByWebsite(
      fixture.website._id,
    );
    await Promise.all([backfill(), ingestWave(fixture.website)]);
    await assertSameAsReference(TENANT, fixture);
  });
});
