const assert = require("node:assert/strict");
const test = it;
const { GetModel } = require("@antelopejs/interface-database-decorators");
const { MarketingEventsModel } = require("../dist/db");
const { funnelTemplates } = require("../dist/services/funnel-report");
const { computeFunnelResults } = require("../dist/services/funnels");
const { WINDOWS, seedFixture } = require("./helpers/funnel-fixture");
const {
  referenceFunnelResults,
  referenceTemplates,
} = require("./helpers/raw-funnel-reference");

const TENANT = "funnel-trails";
const WEBSITE_ID = "funnel-trails-site";

/** @type {Awaited<ReturnType<typeof seedFixture>>} */
let fixture;

function events() {
  return GetModel(MarketingEventsModel, TENANT);
}

/**
 * @param {Awaited<ReturnType<typeof seedFixture>>["funnels"][number]} funnel
 * @param {(typeof WINDOWS)[number]} window
 */
async function readResults(funnel, window) {
  const { truncated, ...results } = await computeFunnelResults(
    events(),
    funnel,
    window.since,
    window.until,
  );
  assert.equal(truncated, false, `${funnel.name} over ${window.name}`);
  return results;
}

/** Every funnel over every window, and the templates: the read against the frozen reference. */
async function assertSameAsReference() {
  for (const funnel of fixture.funnels) {
    for (const window of WINDOWS) {
      assert.deepEqual(
        await readResults(funnel, window),
        await referenceFunnelResults(events(), funnel, window),
        `${funnel.name} over ${window.name}`,
      );
    }
  }
  for (const window of WINDOWS) {
    assert.deepEqual(
      await funnelTemplates(fixture.website, window),
      await referenceTemplates(events(), fixture.website, window),
      `templates over ${window.name}`,
    );
  }
}

/**
 * @param {string} name
 * @param {(typeof WINDOWS)[number]} window
 */
async function read(name, window) {
  const funnel = fixture.funnels.find((candidate) => candidate.name === name);
  if (!funnel) {
    throw new Error(`no fixture funnel named ${name}`);
  }
  return readResults(funnel, window);
}

describe("funnel results over sessions that skip, repeat and reorder steps", () => {
  before(async function () {
    this.timeout(60_000);
    fixture = await seedFixture(TENANT, WEBSITE_ID);
  });

  test("the fixture reads as counted by hand", async () => {
    const [whole] = WINDOWS;
    const pages = await read("pages", whole);
    assert.deepEqual(
      pages.computation.steps.map((step) => step.sessions),
      [42, 14, 10],
    );
    const ordered = await read("prefix and event", whole);
    assert.deepEqual(
      ordered.computation.steps.map((step) => step.sessions),
      [6, 6, 4],
    );
    const split = await read("stopped split", whole);
    assert.deepEqual(
      split.experiment?.variations.map((arm) => [
        arm.key,
        arm.exposedSessions,
        arm.conversions,
      ]),
      [
        ["control", 9, 5],
        ["bold", 10, 6],
      ],
    );
    assert.deepEqual(await funnelTemplates(fixture.website, whole), [
      {
        steps: [
          { kind: "url", value: "/landing" },
          { kind: "custom", value: "buy" },
        ],
        entering: 29,
      },
      {
        steps: [
          { kind: "url", value: "/zeta" },
          { kind: "custom", value: "subscribe" },
        ],
        entering: 2,
      },
    ]);
  });

  test("every funnel, window and template equals the raw read", async () => {
    await assertSameAsReference();
  });
});
