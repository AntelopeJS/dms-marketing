const assert = require("node:assert/strict");
const { mock } = require("node:test");
const { GetModel } = require("@antelopejs/interface-database-decorators");
const models = require("@antelopejs/interface-database-decorators/model");
const { FunnelTrailsModel, MarketingEventsModel } = require("../../dist/db");
const {
  backfillAllTenants,
  funnelResultsIn,
  funnelTemplates,
} = require("../../dist/services/funnels");
const { WINDOWS } = require("./funnel-fixture");
const {
  referenceFunnelResults,
  referenceTemplates,
} = require("./raw-funnel-reference");

/** @typedef {Awaited<ReturnType<typeof import("./funnel-fixture").seedFixture>>} Fixture */

/**
 * Read while the files load, before any test has mocked it: other files mock
 * GetModel and the harness never gets the original back.
 */
const realGetModel = models.GetModel;

/** The module reads the real models in the hooks and tests of this suite. */
function useRealModels() {
  before(() => {
    mock.method(models, "GetModel", realGetModel);
  });
  beforeEach(() => {
    mock.method(models, "GetModel", realGetModel);
  });
  afterEach(() => {
    mock.restoreAll();
  });
}

/**
 * Every funnel of the fixture over every window, and the templates, against
 * the frozen raw read: a complete read, and the same answer.
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

/** One backfill pass that reports no failure. */
async function backfill() {
  /** @type {Error[]} */
  const failures = [];
  await backfillAllTenants((failure) => failures.push(failure));
  assert.deepEqual(failures, []);
}

/**
 * Per session of the website, how many events its trail holds.
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
 * How many pageviews, custom events and exposures the website's raw events
 * hold: what its trails hold together, once they cover it.
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

module.exports = {
  assertSameAsReference,
  backfill,
  rawFunnelEventCount,
  total,
  trailSizes,
  useRealModels,
};
