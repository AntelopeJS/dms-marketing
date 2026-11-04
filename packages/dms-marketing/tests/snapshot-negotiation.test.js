const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const { EnsureWebsite } = require("@antelopejs/interface-dms-marketing");
const { setConfig } = require("../dist/config");
const { PageSnapshotsModel, WebsitesModel } = require("../dist/db");
const sessionize = require("../dist/services/sessionize");
const { resetHeatmap } = require("../dist/services/heatmap");
const { pruneSnapshots } = require("../dist/services/prune");
const {
  deleteSnapshots,
  snapshotId,
  storeSnapshot,
  summarizeSnapshots,
  wantsSnapshot,
} = require("../dist/services/snapshots");
const {
  MAX_SNAPSHOTS_PER_WEBSITE,
  SNAPSHOT_CAPTURE_CACHE_TTL_MS,
  SNAPSHOT_PROMISE_TTL_MS,
} = require("../dist/types/constants");

/**
 * @typedef {import("../dist/db/tables/websites.table").Website} Website
 * @typedef {import("../dist/db/tables/page_snapshots.table").PageSnapshot} PageSnapshot
 * @typedef {import("../dist/types/snapshots").SnapshotLayout} SnapshotLayout
 */

/** Read while the files load, before any test has mocked it. */
const realGetModel = models.GetModel;
const TENANT = "default";
const SITE = "snapshot-negotiation";
const HOST = "negotiation-test.example.com";
const DESKTOP = 1280;

/** @returns {Promise<Website>} */
async function website() {
  await EnsureWebsite({
    id: SITE,
    tenantId: TENANT,
    name: "Negotiation",
    domain: HOST,
    snapshotsEnabled: true,
  });
  const row = await realGetModel(WebsitesModel).get(SITE);
  assert.ok(row, "the declared website is stored");
  return row;
}

function snapshots() {
  return realGetModel(PageSnapshotsModel, TENANT);
}

/**
 * A negotiation answered and its upload stored, as one sampled visit.
 * @param {Website} site
 * @param {string} path
 * @param {string} [visitor]
 */
async function capture(site, path, visitor = "visitor") {
  const token = await wantsSnapshot(site, path, DESKTOP, visitor);
  assert.ok(token, `a capture of ${path} is wanted`);
  return storeSnapshot(
    site,
    {
      website: SITE,
      url: `https://${HOST}${path}`,
      viewport: { width: DESKTOP, height: 800 },
      document: { width: DESKTOP, height: 2400 },
      token,
      html: "<html><body><main data-marketing-scroll-root>Page",
    },
    visitor,
  );
}

/**
 * Lets the clock run on by `ms`, the database untouched.
 * @param {number} ms
 */
function advance(ms) {
  const now = Date.now();
  mock.method(Date, "now", () => now + ms);
}

describe("the snapshot negotiation", () => {
  beforeEach(() => {
    mock.method(models, "GetModel", realGetModel);
    mock.method(sessionize, "findOpenSession", async () => ({
      exitUrl: currentPath,
    }));
  });
  afterEach(() => {
    mock.restoreAll();
    setConfig({});
  });

  let currentPath = "/";
  /**
   * @param {Website} site
   * @param {string} path
   */
  async function captured(site, path) {
    currentPath = path;
    assert.equal(await capture(site, path), true);
    assert.equal(await wantsSnapshot(site, path, DESKTOP, "next"), undefined);
  }

  test("records the scroll root mark with the capture", async () => {
    const site = await website();
    await captured(site, "/marked");
    const row = await snapshots().get(snapshotId(SITE, "desktop", "/marked"));
    assert.equal(row.scrollRoot, true);
  });

  test("notices within its cache TTL a snapshot deleted by another instance", async () => {
    const site = await website();
    await captured(site, "/elsewhere");
    await snapshots().deleteByWebsite(SITE, "/elsewhere");
    assert.equal(
      await wantsSnapshot(site, "/elsewhere", DESKTOP, "next"),
      undefined,
    );
    advance(SNAPSHOT_CAPTURE_CACHE_TTL_MS);
    assert.ok(await wantsSnapshot(site, "/elsewhere", DESKTOP, "next"));
  });

  test("captures a pruned page at its next visit", async () => {
    const site = await website();
    await captured(site, "/pruned");
    await new Promise((resolve) => setTimeout(resolve, 5));
    setConfig({ snapshotRetention: 1 });
    assert.ok((await pruneSnapshots(snapshots())) >= 1);
    assert.ok(await wantsSnapshot(site, "/pruned", DESKTOP, "next"));
  });

  test("captures a page at once after its heatmap reset", async () => {
    const site = await website();
    await captured(site, "/reset");
    const deleted = await resetHeatmap(TENANT, SITE, "/reset");
    assert.equal(deleted.snapshots, 1);
    assert.ok(await wantsSnapshot(site, "/reset", DESKTOP, "next"));
  });

  test("captures every page at once after the site's snapshots go", async () => {
    const site = await website();
    await captured(site, "/site-wide");
    await deleteSnapshots(TENANT, SITE);
    assert.ok(await wantsSnapshot(site, "/site-wide", DESKTOP, "next"));
  });

  test("does not count a refused upload as a capture", async () => {
    const site = await website();
    currentPath = "/refused";
    mock.method(
      PageSnapshotsModel.prototype,
      "countByWebsite",
      async () => MAX_SNAPSHOTS_PER_WEBSITE,
    );
    assert.equal(await capture(site, "/refused"), false);
    assert.ok(await wantsSnapshot(site, "/refused", DESKTOP, "next"));
    assert.equal(
      await wantsSnapshot(site, "/refused", DESKTOP, "third"),
      undefined,
    );
    advance(SNAPSHOT_PROMISE_TTL_MS);
    assert.ok(await wantsSnapshot(site, "/refused", DESKTOP, "third"));
  });

  test("replaces early a capture taken before the scroll root mark", async () => {
    const site = await website();
    /**
     * @param {string} path
     * @param {Record<string, unknown>} [extra]
     * @returns {PageSnapshot}
     */
    const legacy = (path, extra = {}) => ({
      _id: snapshotId(SITE, "desktop", path),
      websiteId: SITE,
      url: path,
      layout: "desktop",
      origin: `https://${HOST}`,
      viewportWidth: DESKTOP,
      viewportHeight: 800,
      documentWidth: DESKTOP,
      documentHeight: 800,
      capturedAt: new Date(),
      bytes: 10,
      html: "",
      ...extra,
    });
    await snapshots().upsert(legacy("/legacy"));
    await snapshots().upsert(legacy("/checked", { scrollRoot: false }));
    assert.equal(
      await wantsSnapshot(site, "/legacy", DESKTOP, "next"),
      undefined,
    );
    assert.ok(await wantsSnapshot(site, "/legacy", DESKTOP, "other", true));
    assert.equal(
      await wantsSnapshot(site, "/checked", DESKTOP, "next", true),
      undefined,
    );
  });
});

describe("the pages list's snapshot summary", () => {
  beforeEach(() => mock.method(models, "GetModel", realGetModel));
  afterEach(() => mock.restoreAll());

  test("tells each path's newest capture and layouts from one read", async () => {
    const site = "snapshot-summary";
    /**
     * @param {string} url
     * @param {SnapshotLayout} layout
     * @param {number} at
     * @param {number} [documentWidth]
     * @returns {PageSnapshot}
     */
    const row = (url, layout, at, documentWidth = DESKTOP) => ({
      _id: snapshotId(site, layout, url),
      websiteId: site,
      url,
      layout,
      origin: `https://${HOST}`,
      viewportWidth: DESKTOP,
      viewportHeight: 800,
      documentWidth,
      documentHeight: documentWidth ? 800 : 0,
      capturedAt: new Date(at),
      bytes: 10,
      html: documentWidth ? "x" : "",
    });
    for (const capture of [
      row("/a", "desktop", 1_000),
      row("/a", "phone", 3_000),
      row("/a", "tablet", 9_000, 0),
      row("/heavy", "desktop", 5_000, 0),
    ]) {
      await snapshots().upsert(capture);
    }
    const reads = mock.method(PageSnapshotsModel.prototype, "listCaptures");
    const summary = await summarizeSnapshots(TENANT, site);
    assert.equal(reads.mock.callCount(), 1);
    assert.deepEqual(Object.fromEntries(summary), {
      "/a": {
        capturedAt: 3_000,
        layouts: ["desktop", "phone"],
        tooHeavy: false,
      },
      "/heavy": { capturedAt: 5_000, layouts: [], tooHeavy: true },
    });
    const [stored] = await snapshots().listCaptures(site);
    assert.equal(stored.html, undefined);
  });
});
