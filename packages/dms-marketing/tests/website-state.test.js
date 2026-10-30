const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const {
  EnsureWebsite,
  ImportAnalytics,
} = require("@antelopejs/interface-dms-marketing");
const { WebsitesModel } = require("../dist/db");
const { processCollectBatch } = require("../dist/services/collect");
const {
  loadWebsiteActivity,
  toContextWebsite,
} = require("../dist/services/context");

/** Read while the files load, before any test has mocked it. */
const realGetModel = models.GetModel;
const ORIGIN = "https://state-test.example.com";
const MINUTE = 60_000;

/**
 * @typedef {import("../dist/db/tables/websites.table").Website} Website
 * @typedef {import("../dist/services/context").WebsiteActivity} WebsiteActivity
 */

/**
 * @param {number} [lastActivity]
 * @param {number} [importedThrough]
 * @returns {WebsiteActivity}
 */
function activity(lastActivity, importedThrough) {
  /** @param {number | undefined} at */
  const of = (at) => new Map(at === undefined ? [] : [["site", at]]);
  return {
    lastActivity: of(lastActivity),
    importedThrough: of(importedThrough),
  };
}

/**
 * @param {Pick<Website, "trackingEnabled">} website
 * @param {number} [lastActivity]
 * @param {number} [importedThrough]
 */
function stateOf(website, lastActivity, importedThrough) {
  return toContextWebsite(
    { _id: "site", name: "Site", domain: "a.test", ...website },
    activity(lastActivity, importedThrough),
  ).state;
}

describe("a website's state", () => {
  beforeEach(() => mock.method(models, "GetModel", realGetModel));
  afterEach(() => mock.restoreAll());

  test("is imported while no activity is newer than its imports", () => {
    const tracking = { trackingEnabled: true };
    assert.equal(stateOf(tracking), "waiting");
    assert.equal(stateOf(tracking, 5_000), "live");
    assert.equal(stateOf(tracking, 5_000, 5_000), "imported");
    assert.equal(stateOf(tracking, 5_001, 5_000), "live");
    assert.equal(stateOf({ trackingEnabled: false }, 1_000, 5_000), "paused");
  });

  test("turns live on the first collected hit after an import", async () => {
    const id = "state-imported";
    await EnsureWebsite({
      id,
      tenantId: "default",
      name: "State",
      domain: new URL(ORIGIN).hostname,
    });
    const read = async () => {
      const website = await realGetModel(WebsitesModel).get(id);
      const loaded = await loadWebsiteActivity("default", [website]);
      return { website, context: toContextWebsite(website, loaded) };
    };
    assert.equal((await read()).context.state, "waiting");

    const at = Date.now() - 10 * MINUTE;
    await ImportAnalytics({
      tenantId: "default",
      importId: "state-history",
      websiteId: id,
      sessions: [
        {
          visitor: "v1",
          events: [{ kind: "pageview", at, url: `${ORIGIN}/` }],
        },
      ],
    });
    const imported = await read();
    assert.deepEqual(
      [imported.context.state, imported.context.lastActivityAt],
      ["imported", at],
    );

    await processCollectBatch(
      imported.website,
      [{ kind: "pageview", url: `${ORIGIN}/live` }],
      { ip: "203.0.113.77", userAgent: "Mozilla/5.0 state test" },
    );
    const live = await read();
    assert.equal(live.context.state, "live");
    assert.ok(live.context.lastActivityAt > at);
  });
});
