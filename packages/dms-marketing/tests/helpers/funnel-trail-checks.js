const assert = require("node:assert/strict");
const { mock } = require("node:test");
const { GetModel } = require("@antelopejs/interface-database-decorators");
const models = require("@antelopejs/interface-database-decorators/model");
const { EnsureWebsite } = require("@antelopejs/interface-dms-marketing");
const {
  FunnelTrailBackfillsModel,
  FunnelTrailsModel,
  MarketingEventsModel,
} = require("../../dist/db");
const { importAnalytics } = require("../../dist/services/analytics-import");
const {
  backfillAllTenants,
  funnelResultsIn,
  funnelTemplates,
} = require("../../dist/services/funnels");
const { WINDOWS } = require("./funnel-fixture");

const DAY = 86_400_000;
const {
  referenceFunnelResults,
  referenceTemplates,
} = require("./raw-funnel-reference");

/** @typedef {Awaited<ReturnType<typeof import("./funnel-fixture").seedFixture>>} Fixture */

const realGetModel = models.GetModel;

/**
 * Mocking an already mocked GetModel stacks the two, and `restoreAll` then
 * puts the inner mock back instead of the original.
 */
function mockRealModels() {
  if (!models.GetModel.mock) {
    mock.method(models, "GetModel", realGetModel);
  }
}

function useRealModels() {
  before(mockRealModels);
  beforeEach(mockRealModels);
  afterEach(() => {
    mock.restoreAll();
  });
}

/**
 * @param {string} tenantId
 * @param {Fixture} site
 */
async function assertSameAsReference(tenantId, site) {
  const events = GetModel(MarketingEventsModel, tenantId);
  for (const funnel of site.funnels) {
    for (const window of WINDOWS) {
      const { incomplete, ...results } = await funnelResultsIn(
        funnel,
        tenantId,
        window,
      );
      const label = `${funnel.name} over ${window.name}`;
      assert.equal(incomplete, false, label);
      assert.deepEqual(
        results,
        await referenceFunnelResults(events, funnel, window),
        label,
      );
    }
  }
  for (const window of WINDOWS) {
    assert.deepEqual(
      await funnelTemplates(site.website, window),
      await referenceTemplates(events, site.website, window),
      `templates over ${window.name}`,
    );
  }
}

async function backfill() {
  /** @type {Error[]} */
  const failures = [];
  await backfillAllTenants((failure) => failures.push(failure));
  assert.deepEqual(failures, []);
}

/**
 * @param {string} tenantId
 * @param {string} websiteId
 */
async function trailSizes(tenantId, websiteId) {
  /** @type {Record<string, number>} */
  const sizes = {};
  for await (const session of GetModel(FunnelTrailsModel, tenantId).sessionsIn({
    websiteId,
    since: 0,
    until: Number.MAX_SAFE_INTEGER,
    withExposures: true,
  })) {
    sizes[session.sessionId] = session.events.length;
  }
  return sizes;
}

/**
 * @param {string} tenantId
 * @param {string} websiteId
 */
async function rawFunnelEventCount(tenantId, websiteId) {
  const rows = await GetModel(MarketingEventsModel, tenantId).queryRange({
    websiteIds: [websiteId],
    since: new Date(0),
    until: new Date(Date.now()),
    kinds: ["pageview", "custom", "exposure"],
    limit: Number.MAX_SAFE_INTEGER,
    fields: [],
  });
  return rows.length;
}

/** @param {Record<string, number>} sizes */
function total(sizes) {
  return Object.values(sizes).reduce((sum, size) => sum + size, 0);
}

/**
 * Holds the next backfill flush of the tenant at its first generation
 * check, after its walk read the events: `reached` resolves there, and the
 * flush goes on once `release` is called.
 *
 * @param {string} tenant
 */
function pauseTheNextFlush(tenant) {
  /** @type {() => void} */
  let arrive = () => {};
  /** @type {() => void} */
  let release = () => {};
  const reached = new Promise((resolve) => {
    arrive = () => resolve(undefined);
  });
  const released = new Promise((resolve) => {
    release = () => resolve(undefined);
  });
  let paused = false;
  const pausing = mock.method(
    GetModel(FunnelTrailBackfillsModel, tenant),
    "generationOf",
    /**
     * @this {InstanceType<typeof FunnelTrailBackfillsModel>}
     * @param {string} websiteId
     */
    async function (websiteId) {
      if (!paused) {
        paused = true;
        arrive();
        await released;
      }
      return FunnelTrailBackfillsModel.prototype.generationOf.call(
        this,
        websiteId,
      );
    },
  );
  return { reached, release, pausing };
}

/**
 * @param {string} tenant
 * @param {string} websiteId
 */
async function importStoppedOnSecondDay(tenant, websiteId) {
  await EnsureWebsite({
    id: websiteId,
    tenantId: tenant,
    name: websiteId,
    domain: `${websiteId}.example`,
  });
  const firstDay = Math.floor((Date.now() - 5 * DAY) / DAY) * DAY;
  const minute = (day, minutes) => firstDay + day * DAY + minutes * 60_000;
  const page = (path, day, minutes) => ({
    kind: "pageview",
    at: minute(day, minutes),
    url: `https://${websiteId}.example${path}`,
  });
  const batch = {
    tenantId: tenant,
    importId: "trail-history",
    websiteId,
    sessions: Array.from({ length: 8 }, (_, visitor) => ({
      visitor: `v${visitor}`,
      events: [0, 1, 2]
        .flatMap((day) => [
          page("/a", day, 600 + visitor),
          page("/b", day, 601 + visitor),
          page("/c", day, 602 + visitor),
        ])
        .concat(page("/a", 0, 1438), page("/b", 1, 1)),
    })),
  };
  let stopped = false;
  const stopping = mock.method(
    GetModel(MarketingEventsModel, tenant),
    "insertMany",
    /**
     * @this {InstanceType<typeof MarketingEventsModel>}
     * @param {import("../../dist/db").NewMarketingEvent[]} docs
     */
    async function (docs) {
      const ids = await MarketingEventsModel.prototype.insertMany.call(
        this,
        docs,
      );
      if (
        !stopped &&
        docs.some((doc) => doc.timestamp.getTime() >= minute(1, 601))
      ) {
        stopped = true;
        throw new Error("the import stopped");
      }
      return ids;
    },
  );
  await assert.rejects(importAnalytics(batch), /the import stopped/);
  stopping.mock.restore();
  return { batch, since: new Date(firstDay) };
}

module.exports = {
  assertSameAsReference,
  backfill,
  importStoppedOnSecondDay,
  pauseTheNextFlush,
  rawFunnelEventCount,
  total,
  trailSizes,
  useRealModels,
};
