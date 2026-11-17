const assert = require("node:assert/strict");
const test = it;
const { GetModel } = require("@antelopejs/interface-database-decorators");
const { MarketingEventsModel } = require("../dist/db");
const {
  funnelResultsIn,
  funnelTemplates,
} = require("../dist/services/funnels");
const { WINDOWS, seedFixture } = require("./helpers/funnel-fixture");
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
 * What a read reports apart from the tests of a split, which an incomplete
 * read withholds.
 * @param {Omit<Awaited<ReturnType<typeof funnelResultsIn>>, "incomplete">} results
 */
function counts(results) {
  return {
    computation: results.computation,
    arms: results.experiment?.variations.map((arm) => ({
      key: arm.key,
      exposedSessions: arm.exposedSessions,
      conversions: arm.conversions,
      computation: arm.computation,
    })),
    window: results.window,
  };
}

/**
 * Every funnel over every window, and the templates, against the frozen raw
 * read, but for the tests of a split.
 * @param {Fixture} site
 */
async function assertSameCountsAsReference(site) {
  for (const funnel of site.funnels) {
    for (const window of WINDOWS) {
      assert.deepEqual(
        counts(await funnelResultsIn(funnel, TENANT, window)),
        counts(await referenceFunnelResults(events(), funnel, window)),
        `${funnel.name} over ${window.name}`,
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

  test("live sessions count as the raw read counts them", async () => {
    await assertSameCountsAsReference(live);
  });
});
