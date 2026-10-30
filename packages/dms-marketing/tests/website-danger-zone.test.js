const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const { ControllerMeta } = require("@antelopejs/interface-api");
const { GetMetadata } = require("@antelopejs/interface-core");
const models = require("@antelopejs/interface-database-decorators/model");
const { EnsureWebsite } = require("@antelopejs/interface-dms-marketing");
const {
  FunnelsModel,
  MarketingEventsModel,
  MarketingImportsModel,
  MarketingSessionsModel,
  PageSnapshotsModel,
  WebsiteStatisticsModel,
  WebsitesModel,
} = require("../dist/db");
const { WebsitesController } = require("../dist/routes/websites");
const { dashboardWebsiteId } = require("../dist/services/dashboard-tracking");
const {
  computePageActivity,
  resetHeatmap,
} = require("../dist/services/heatmap");
const { trailingWindow } = require("../dist/services/period");
const {
  purgeWebsiteCollectedData,
} = require("../dist/services/tenant-website");
const { websiteDeletionImpact } = require("../dist/services/website-report");

/** Read while the files load, before any test has mocked it. */
const realGetModel = models.GetModel;

const TENANT = "default";
/**
 * A request of the default tenant, as the JWT fallback reads it; a fresh one
 * per call, since a guard keeps what it resolved on its request.
 */
const tenantRequest = () => ({ rawRequest: { headers: {} } });
const OWNER = { _id: "owner" };
const ALL = { scope: "all" };
const HEATMAPS = { scope: "heatmaps" };

const controller = new WebsitesController();

/** @typedef {{ getStatus(): number }} HttpFailure what an HTTPResult rejection exposes */

/**
 * The status an HTTPResult rejection carries.
 * @param {number} code
 * @returns {(error: HttpFailure) => boolean}
 */
const status = (code) => (error) => error.getStatus() === code;

/**
 * @typedef {abstract new (...args: never[]) => unknown} ModelClass
 * @typedef {{ deleteByWebsite(): Promise<number> }} FakeTable
 * @typedef {{ _id: string, tenantId: string, name: string }} FakeSite
 * @typedef {{
 *   get(id: string): Promise<FakeSite | undefined>,
 *   delete(id: string): Promise<void>,
 * }} FakeWebsitesTable
 */

/** A websites table of three sites over fake tenant tables. */
function fakeStore() {
  /** @type {Record<string, number>} */
  const rows = { events: 5, funnels: 2 };
  /** @param {string} key */
  const table = (key) => ({
    async deleteByWebsite() {
      const deleted = rows[key] ?? 0;
      rows[key] = 0;
      return deleted;
    },
  });
  /**
   * @param {string} id
   * @param {string} tenantId
   * @returns {FakeSite}
   */
  const site = (id, tenantId) => ({ _id: id, tenantId, name: id });
  const websites = new Map(
    [
      site("guard-site", TENANT),
      site(dashboardWebsiteId(TENANT), TENANT),
      site("guard-foreign", "other"),
    ].map((website) => [website._id, website]),
  );
  /** @type {Map<ModelClass, FakeTable | FakeWebsitesTable>} */
  const byModel = new Map([
    [MarketingEventsModel, table("events")],
    [MarketingSessionsModel, table("sessions")],
    [WebsiteStatisticsModel, table("days")],
    [PageSnapshotsModel, table("snapshots")],
    [MarketingImportsModel, table("imports")],
    [FunnelsModel, table("funnels")],
    [
      WebsitesModel,
      {
        /** @param {string} id */
        get: async (id) => websites.get(id),
        /** @param {string} id */
        delete: async (id) => void websites.delete(id),
      },
    ],
  ]);
  /** @param {ModelClass} model */
  const fakeGetModel = (model) => byModel.get(model);
  mock.method(models, "GetModel", fakeGetModel);
  return { rows, websites };
}

describe("deleting a website", () => {
  afterEach(() => mock.restoreAll());

  test("the dashboard's own site is refused with a 409, data and all kept", async () => {
    const { rows, websites } = fakeStore();
    const id = dashboardWebsiteId(TENANT);
    await assert.rejects(
      controller.remove(OWNER, id, tenantRequest()),
      (error) =>
        error.getStatus() === 409 &&
        String(error.getBody()).includes("dashboard_website_kept"),
    );
    assert.ok(websites.has(id));
    assert.equal(rows.events, 5);
  });

  test("any other site goes, with its data and its funnels", async () => {
    const { rows, websites } = fakeStore();
    assert.deepEqual(
      await controller.remove(OWNER, "guard-site", tenantRequest()),
      { deleted: "guard-site" },
    );
    assert.ok(!websites.has("guard-site"));
    assert.equal(rows.events, 0);
    assert.equal(rows.funnels, 0);
  });

  test("another tenant's site answers 404", async () => {
    const { websites } = fakeStore();
    await assert.rejects(
      controller.remove(OWNER, "guard-foreign", tenantRequest()),
      status(404),
    );
    assert.ok(websites.has("guard-foreign"));
  });
});

describe("the purge route", () => {
  afterEach(() => mock.restoreAll());

  test("purges the dashboard's own site too, and keeps it", async () => {
    const { rows, websites } = fakeStore();
    const id = dashboardWebsiteId(TENANT);
    const answer = await controller.purge(OWNER, id, ALL, tenantRequest());
    assert.equal(answer.purged, id);
    assert.equal(answer.deleted.events, 5);
    assert.ok(websites.has(id));
    assert.equal(rows.funnels, 2);
  });

  test("another tenant's site answers 404 and keeps its data", async () => {
    const { rows } = fakeStore();
    await assert.rejects(
      controller.purge(OWNER, "guard-foreign", ALL, tenantRequest()),
      status(404),
    );
    assert.equal(rows.events, 5);
  });

  test("a scope is never implied", async () => {
    const { rows } = fakeStore();
    for (const body of [{}, { scope: "everything" }, null]) {
      await assert.rejects(
        controller.purge(OWNER, "guard-site", body, tenantRequest()),
        status(400),
      );
    }
    assert.equal(rows.events, 5);
  });

  /**
   * What the route resolves its first parameter (the caller) with.
   * @param {string} handler
   */
  function callerProvider(handler) {
    const meta = GetMetadata(WebsitesController, ControllerMeta);
    return meta.getParameterArray(handler)[0].provider;
  }

  for (const handler of ["purge", "remove"]) {
    test(`${handler} takes a tenant owner, and refuses an anonymous call`, async () => {
      const provider = callerProvider(handler);
      assert.match(String(provider), /requireOwner: true/);
      assert.equal(String(provider), String(callerProvider("update")));
      /** @param {HttpFailure} error */
      const refused = (error) => [401, 403].includes(error.getStatus());
      await assert.rejects(provider(tenantRequest()), refused);
    });
  }
});

const DAY_MS = 86_400_000;

/**
 * @param {string} websiteId
 * @param {string} kind
 * @param {string} url
 * @param {number} at
 */
function event(websiteId, kind, url, at) {
  const timestamp = new Date(at);
  return {
    websiteId,
    timestamp,
    day: Math.floor(at / DAY_MS) * DAY_MS,
    kind,
    sessionId: `${websiteId}-session`,
    visitorId: `${websiteId}-visitor`,
    url,
  };
}

/**
 * A site with traffic on two pages: pageviews, clicks, scrolls, an A/B
 * exposure, a session, a day of statistics, a snapshot, an import claim and
 * a funnel.
 * @param {string} id
 */
async function seededSite(id) {
  await EnsureWebsite({
    id,
    tenantId: TENANT,
    name: id,
    domain: `${id}.example.com`,
  });
  const now = Date.now() - 60_000;
  const day = Math.floor(now / DAY_MS) * DAY_MS;
  await realGetModel(MarketingEventsModel, TENANT).insertMany([
    event(id, "pageview", "/", now),
    event(id, "pageview", "/pricing", now),
    event(id, "click", "/", now),
    event(id, "click", "/", now),
    event(id, "click", "/pricing", now),
    event(id, "scroll", "/", now),
    event(id, "scroll", "/pricing", now),
    { ...event(id, "exposure", "/", now), name: "hero" },
  ]);
  await realGetModel(MarketingSessionsModel, TENANT).insert({
    _id: `${id}-session`,
    websiteId: id,
    visitorId: `${id}-visitor`,
    startedAt: new Date(now),
    lastSeenAt: new Date(now),
    isNewVisitor: true,
    entryUrl: "/",
    exitUrl: "/pricing",
    pageviewsCount: 2,
    eventsCount: 8,
  });
  await realGetModel(WebsiteStatisticsModel, TENANT).insert({
    _id: `${id}:${day}`,
    websiteId: id,
    day,
    sessions: 1,
    pageviews: 2,
  });
  await realGetModel(PageSnapshotsModel, TENANT).insert({
    _id: `${id}-snapshot`,
    websiteId: id,
    url: "/",
    layout: "desktop",
    capturedAt: new Date(now),
  });
  await realGetModel(MarketingImportsModel, TENANT).insert({
    _id: `${id}:history`,
    websiteId: id,
    importId: "history",
    status: "done",
  });
  await realGetModel(FunnelsModel, TENANT).insert({
    _id: `${id}-funnel`,
    websiteId: id,
    name: "Checkout",
    steps: [{ kind: "url", value: "/pricing" }],
  });
}

/** @param {string} id */
const clicksOf = async (id) =>
  (await computePageActivity(TENANT, id, trailingWindow(7))).clicks;

/** @param {string} id */
async function eventKinds(id) {
  const rows = await realGetModel(MarketingEventsModel, TENANT)
    .table.getAll([id], "websiteId")
    .run();
  return rows.map((row) => row.kind).sort((a, b) => a.localeCompare(b));
}

describe("purging a website's data", () => {
  beforeEach(() => mock.method(models, "GetModel", realGetModel));
  afterEach(() => mock.restoreAll());

  test("the confirmation counts what each scope deletes", async () => {
    await seededSite("purge-impact");
    const impact = await websiteDeletionImpact(
      await realGetModel(WebsitesModel).get("purge-impact"),
    );
    assert.equal(impact.sessions, 1);
    assert.equal(impact.pageviews, 2);
    assert.equal(impact.heatmapEvents, 5);
    assert.equal(impact.snapshots, 1);
    assert.equal(impact.funnels, 1);
  });

  test("heatmaps only: every page's clicks drop to zero, the traffic stays", async () => {
    await seededSite("purge-heatmaps");
    assert.deepEqual(Object.fromEntries(await clicksOf("purge-heatmaps")), {
      "/": 2,
      "/pricing": 1,
    });
    const { deleted } = await controller.purge(
      OWNER,
      "purge-heatmaps",
      HEATMAPS,
      tenantRequest(),
    );
    assert.deepEqual(deleted, {
      events: 5,
      snapshots: 1,
      sessions: 0,
      days: 0,
      imports: 0,
    });
    assert.equal((await clicksOf("purge-heatmaps")).size, 0);
    assert.deepEqual(await eventKinds("purge-heatmaps"), [
      "exposure",
      "pageview",
      "pageview",
    ]);
    const impact = await websiteDeletionImpact(
      await realGetModel(WebsitesModel).get("purge-heatmaps"),
    );
    assert.equal(impact.sessions, 1);
    assert.equal(impact.pageviews, 2);
    assert.equal(impact.heatmapEvents, 0);
    assert.equal(impact.snapshots, 0);
  });

  test("all: everything collected goes; the site and its funnels stay", async () => {
    await seededSite("purge-all");
    const answer = await controller.purge(
      OWNER,
      "purge-all",
      ALL,
      tenantRequest(),
    );
    assert.deepEqual(answer, {
      purged: "purge-all",
      scope: "all",
      deleted: { events: 8, sessions: 1, days: 1, snapshots: 1, imports: 1 },
    });
    assert.deepEqual(await eventKinds("purge-all"), []);
    assert.equal((await clicksOf("purge-all")).size, 0);
    assert.ok(await realGetModel(WebsitesModel).get("purge-all"));
    const funnels = await realGetModel(FunnelsModel, TENANT).listByWebsite(
      "purge-all",
    );
    assert.equal(funnels.length, 1);
    assert.deepEqual(
      await realGetModel(MarketingImportsModel, TENANT).listByWebsite(
        "purge-all",
      ),
      [],
    );

    const again = await controller.purge(
      OWNER,
      "purge-all",
      ALL,
      tenantRequest(),
    );
    assert.deepEqual(again.deleted, {
      events: 0,
      sessions: 0,
      days: 0,
      snapshots: 0,
      imports: 0,
    });
  });

  test("another site of the tenant keeps its data", async () => {
    await seededSite("purge-neighbour");
    await seededSite("purge-target");
    await purgeWebsiteCollectedData(TENANT, "purge-target", "all");
    assert.equal((await eventKinds("purge-neighbour")).length, 8);
  });

  test("a page reset drops that page's clicks to zero, and only its", async () => {
    await seededSite("purge-page");
    await resetHeatmap(TENANT, "purge-page", "/");
    assert.deepEqual(Object.fromEntries(await clicksOf("purge-page")), {
      "/pricing": 1,
    });
  });
});
