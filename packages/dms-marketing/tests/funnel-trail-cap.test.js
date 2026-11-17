const assert = require("node:assert/strict");
const test = it;
const { mock } = require("node:test");
const { GetModel } = require("@antelopejs/interface-database-decorators");
const models = require("@antelopejs/interface-database-decorators/model");
const {
  FunnelTrailBackfillsModel,
  FunnelTrailsModel,
  MarketingEventsModel,
} = require("../dist/db");
const {
  ingestPreparedBatch,
  prepareEvents,
} = require("../dist/services/collect");
const { funnelResultsIn } = require("../dist/services/funnels");
const { purgeWebsiteTrackingData } = require("../dist/services/tenant-website");
const {
  MAX_COLLECT_BATCH_SIZE,
  MAX_TRAIL_EVENTS,
} = require("../dist/types/constants");
const { WINDOWS, at, seedFixture } = require("./helpers/funnel-fixture");
const { backfill, useRealModels } = require("./helpers/funnel-trail-checks");
const { referenceFunnelResults } = require("./helpers/raw-funnel-reference");

const TENANT = "funnel-trail-cap";
const realGetModel = models.GetModel;
const DAY = 86_400_000;
const HEAVY_EVENTS = 6000;

/**
 * One session over the cap: exposed to `bold` in the split's second run, it
 * converts at once, then sends pageviews one second apart.
 *
 * @returns {{ kind: string, path: string, name?: string, data?: Record<string, unknown>, at: number }[]}
 */
function heavySession() {
  const start = at(330);
  return [
    {
      kind: "exposure",
      path: "/landing",
      name: "hero",
      data: { experiment: "hero", variation: "bold" },
      at: start,
    },
    { kind: "pageview", path: "/a", at: start + 1000 },
    { kind: "custom", path: "/", name: "buy", at: start + 2000 },
    ...Array.from({ length: HEAVY_EVENTS - 3 }, (_, index) => ({
      kind: "pageview",
      path: "/x",
      at: start + 3000 + index * 1000,
    })),
  ];
}

/** @typedef {ReturnType<typeof heavySession>[number]} CollectedEvent */

/**
 * @param {import("../dist/db").Website} website
 * @param {string} visitor
 * @param {CollectedEvent[]} batch
 */
async function collect(website, visitor, batch) {
  const outcome = await ingestPreparedBatch(
    website,
    prepareEvents(
      website._id,
      batch.map((event) => ({
        kind: event.kind,
        url: `https://trails.example${event.path}`,
        name: event.name,
        data: event.data,
        at: event.at,
      })),
    ),
    {
      visitorId: `${website._id}-${visitor}`,
      now: new Date(batch[batch.length - 1].at),
      device: {},
      trustTimestamps: true,
    },
  );
  await outcome?.rollup;
}

/**
 * @param {import("../dist/db").Website} website
 */
async function collectHeavy(website) {
  const events = heavySession();
  for (let from = 0; from < events.length; from += MAX_COLLECT_BATCH_SIZE) {
    await collect(
      website,
      "heavy",
      events.slice(from, from + MAX_COLLECT_BATCH_SIZE),
    );
  }
}

/**
 * Enough exposed sessions in the split's second run for a p-value: each arm
 * has at least five conversions and five sessions that do not convert.
 *
 * @param {import("../dist/db").Website} website
 */
async function collectCrowd(website) {
  const arms = [
    { variation: "control", converting: 6, idle: 7 },
    { variation: "bold", converting: 9, idle: 5 },
  ];
  let minute = 340;
  for (const { variation, converting, idle } of arms) {
    for (let index = 0; index < converting + idle; index++) {
      const start = at(minute);
      minute += 1;
      await collect(website, `${variation}-${index}`, [
        { kind: "pageview", path: "/landing", at: start },
        {
          kind: "exposure",
          path: "/landing",
          name: "hero",
          data: { experiment: "hero", variation },
          at: start + 1000,
        },
        { kind: "pageview", path: "/a", at: start + 2000 },
        ...(index < converting
          ? [{ kind: "custom", path: "/", name: "buy", at: start + 3000 }]
          : []),
      ]);
    }
  }
}

/**
 * @param {import("../dist/db").Website} website
 */
async function storeHeavyForTheBackfill(website) {
  const sessionId = `${website._id}-heavy`;
  await GetModel(MarketingEventsModel, TENANT).insertMany(
    heavySession().map((event) => ({
      websiteId: website._id,
      timestamp: new Date(event.at),
      day: Math.floor(event.at / DAY) * DAY,
      kind: event.kind,
      sessionId,
      visitorId: `${sessionId}-visitor`,
      url: event.path,
      name: event.name,
      data: event.data,
    })),
  );
  await GetModel(FunnelTrailBackfillsModel, TENANT).deleteByWebsite(
    website._id,
  );
  await backfill();
}

/**
 * What the A/B pane shows of a split, without the event counts: a session
 * past the cap counts only its kept events there.
 *
 * @param {import("../dist/services/experiments/results").ExperimentResults | undefined} experiment
 */
function verdict(experiment) {
  assert.ok(experiment);
  return {
    ...experiment,
    variations: experiment.variations.map(
      ({ computation: _computation, ...variation }) => variation,
    ),
  };
}

/**
 * @param {string} websiteId
 */
async function heavyTrail(websiteId) {
  for await (const session of GetModel(FunnelTrailsModel, TENANT).sessionsIn({
    websiteId,
    since: 0,
    until: Number.MAX_SAFE_INTEGER,
    withExposures: true,
  })) {
    if (session.events.length > 100) {
      return session.events.map((event) => event.at);
    }
  }
  return [];
}

describe("a session past its funnel trail's cap", () => {
  useRealModels();

  /** @type {Awaited<ReturnType<typeof seedFixture>>} */
  let collected;
  /** @type {Awaited<ReturnType<typeof seedFixture>>} */
  let backfilled;

  before(async function () {
    this.timeout(120_000);
    collected = await seedFixture(TENANT, "cap-collected", false);
    await collectCrowd(collected.website);
    await collectHeavy(collected.website);
    backfilled = await seedFixture(TENANT, "cap-backfilled", false);
    await collectCrowd(backfilled.website);
    await storeHeavyForTheBackfill(backfilled.website);
  });

  after(async function () {
    this.timeout(60_000);
    const real = mock.method(models, "GetModel", realGetModel);
    for (const site of [collected, backfilled]) {
      await purgeWebsiteTrackingData(TENANT, site.website._id);
    }
    real.mock.restore();
  });

  for (const site of ["collected", "backfilled"]) {
    test(`leaves the A/B verdict as the raw read gives it, ${site}`, async () => {
      const fixture = site === "collected" ? collected : backfilled;
      const events = GetModel(MarketingEventsModel, TENANT);
      for (const name of ["running split", "stopped split"]) {
        const funnel = fixture.funnels.find(
          (candidate) => candidate.name === name,
        );
        assert.ok(funnel);
        const results = await funnelResultsIn(funnel, TENANT, WINDOWS[0]);
        const reference = await referenceFunnelResults(
          events,
          funnel,
          WINDOWS[0],
        );
        assert.deepEqual(
          verdict(results.experiment),
          verdict(reference.experiment),
          name,
        );
        assert.equal(results.incomplete, false, name);
        assert.notEqual(
          results.experiment?.variations[1]?.pValue ?? null,
          null,
          name,
        );
      }
    });
  }

  test("keeps the same events whether collected or backfilled: its earliest", async () => {
    const start = at(330);
    const earliest = heavySession()
      .slice(0, MAX_TRAIL_EVENTS)
      .map((event) => event.at);
    assert.equal(earliest[0], start);
    assert.deepEqual(await heavyTrail(collected.website._id), earliest);
    assert.deepEqual(await heavyTrail(backfilled.website._id), earliest);
  });
});
