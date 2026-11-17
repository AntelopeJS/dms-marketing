const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const { GetModel } = require("@antelopejs/interface-database-decorators");
const { EnsureWebsite } = require("@antelopejs/interface-dms-marketing");
const { GetRegisteredHooks, Hook } = require("@antelopejs/interface-dms/hooks");
const { setConfig } = require("../dist/config");
const {
  FunnelTrailBackfillsModel,
  FunnelTrailsModel,
  MarketingEventsModel,
  MarketingSessionsModel,
} = require("../dist/db");
const { WebsitesController } = require("../dist/routes/websites");
const { importAnalytics } = require("../dist/services/analytics-import");
const { funnelResultsIn } = require("../dist/services/funnels");
const {
  purgeWebsiteCollectedData,
  purgeWebsiteTrackingData,
} = require("../dist/services/tenant-website");
const { WINDOWS, at, seedFixture } = require("./helpers/funnel-fixture");
const {
  assertSameAsReference,
  backfill,
  importStoppedOnSecondDay,
  pauseTheNextFlush,
  rawFunnelEventCount,
  total,
  trailSizes,
  useRealModels,
} = require("./helpers/funnel-trail-checks");
const { referenceFunnelResults } = require("./helpers/raw-funnel-reference");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/**
 * @param {string} tenant
 * @param {string} websiteId
 * @param {number} count
 */
async function insertRecentPageviews(tenant, websiteId, count) {
  const timestamp = new Date(Date.now() - 60_000);
  await GetModel(MarketingEventsModel, tenant).insertMany(
    Array.from({ length: count }, (_, index) => ({
      websiteId,
      timestamp,
      day: Math.floor(timestamp.getTime() / DAY) * DAY,
      kind: "pageview",
      sessionId: `recent-${index}`,
      visitorId: `recent-${index}-visitor`,
      url: "/a",
    })),
  );
}

describe("the raw events' retention", () => {
  useRealModels();
  afterEach(() => setConfig());

  test("counts an event just past it until the prune, which drops it from both reads", async function () {
    this.timeout(60_000);
    const tenant = "trail-retention";
    const site = await seedFixture(tenant, "trail-retention-site");
    await backfill();
    const cutoff = new Date(at(99.5));
    setConfig({ rawEventsRetention: Date.now() - cutoff.getTime() });
    await assertSameAsReference(tenant, site);
    await GetModel(MarketingEventsModel, tenant).deleteOlderThan(cutoff);
    await GetModel(FunnelTrailsModel, tenant).deleteOlderThan(cutoff);
    await assertSameAsReference(tenant, site);
    const trails = GetModel(FunnelTrailsModel, tenant).sessionsIn({
      websiteId: site.website._id,
      since: 0,
      until: Number.MAX_SAFE_INTEGER,
      withExposures: true,
    });
    for await (const session of trails) {
      assert.ok(
        session.events.every((event) => event.at >= cutoff.getTime()),
        `${session.sessionId} holds an event before the cutoff`,
      );
    }
  });
});

describe("a website purge", () => {
  useRealModels();

  test("stops a backfill walking the site, and leaves no trail behind", async function () {
    this.timeout(60_000);
    const tenant = "trail-purge";
    const site = await seedFixture(tenant, "trail-purge-site");
    let flushes = 0;
    mock.method(
      GetModel(FunnelTrailBackfillsModel, tenant),
      "widen",
      async () => {
        flushes += 1;
        if (flushes === 1) {
          await purgeWebsiteCollectedData(tenant, site.website._id);
        }
      },
    );
    await backfill();
    assert.equal(flushes, 1);
    assert.deepEqual(await trailSizes(tenant, site.website._id), {});
    const [pages] = site.funnels;
    const results = await funnelResultsIn(pages, tenant, WINDOWS[0]);
    assert.equal(results.incomplete, false);
    assert.equal(results.computation.events, 0);
  });

  test("between a flush's generation check and its write leaves no purged event", async function () {
    this.timeout(60_000);
    const tenant = "trail-purge-race";
    const site = await seedFixture(tenant, "trail-purge-race-site");
    let flushes = 0;
    const racing = mock.method(
      GetModel(FunnelTrailsModel, tenant),
      "recordMany",
      /**
       * @this {InstanceType<typeof FunnelTrailsModel>}
       * @param {string} websiteId
       * @param {Map<string, import("../dist/db").TrailedEvent[]>} sessions
       */
      async function (websiteId, sessions) {
        flushes += 1;
        if (flushes === 1) {
          await purgeWebsiteCollectedData(tenant, websiteId);
        }
        return FunnelTrailsModel.prototype.recordMany.call(
          this,
          websiteId,
          sessions,
        );
      },
    );
    await backfill();
    racing.mock.restore();
    assert.equal(flushes, 1);
    assert.deepEqual(await trailSizes(tenant, site.website._id), {});
    const [pages] = site.funnels;
    const results = await funnelResultsIn(pages, tenant, WINDOWS[0]);
    assert.equal(results.incomplete, false);
    assert.equal(results.computation.events, 0);
  });

  test("of a deleted website takes its backfill row too", async () => {
    const tenant = "trail-delete";
    const site = await seedFixture(tenant, "trail-delete-site", false);
    await backfill();
    assert.ok(
      await GetModel(FunnelTrailBackfillsModel, tenant).get(site.website._id),
    );
    await purgeWebsiteTrackingData(tenant, site.website._id);
    assert.equal(
      await GetModel(FunnelTrailBackfillsModel, tenant).get(site.website._id),
      undefined,
    );
    assert.deepEqual(await trailSizes(tenant, site.website._id), {});
  });
});

describe("a website purge racing a backfill walk", () => {
  useRealModels();

  test("leaves no trail when a walk that began after its first fence flushes after its trail delete", async function () {
    this.timeout(60_000);
    const tenant = "trail-purge-walk";
    const websiteId = "trail-purge-walk-site";
    await EnsureWebsite({
      id: websiteId,
      tenantId: tenant,
      name: websiteId,
      domain: "trail-purge-walk.example",
    });
    await insertRecentPageviews(tenant, websiteId, 9);
    await backfill();
    assert.equal(total(await trailSizes(tenant, websiteId)), 9);
    const walk = pauseTheNextFlush(tenant);
    /** @type {Promise<void> | undefined} */
    let walking;
    const deleting = mock.method(
      GetModel(MarketingEventsModel, tenant),
      "deleteByWebsite",
      /**
       * @this {InstanceType<typeof MarketingEventsModel>}
       * @param {string} site
       */
      async function (site) {
        walking = backfill();
        await walk.reached;
        return MarketingEventsModel.prototype.deleteByWebsite.call(this, site);
      },
    );
    const cleaning = mock.method(
      GetModel(FunnelTrailsModel, tenant),
      "deleteByWebsite",
      /**
       * @this {InstanceType<typeof FunnelTrailsModel>}
       * @param {string} site
       */
      async function (site) {
        const deleted = await FunnelTrailsModel.prototype.deleteByWebsite.call(
          this,
          site,
        );
        walk.release();
        await walking;
        return deleted;
      },
    );
    await purgeWebsiteCollectedData(tenant, websiteId);
    for (const mocked of [walk.pausing, deleting, cleaning]) {
      mocked.mock.restore();
    }
    assert.equal(await rawFunnelEventCount(tenant, websiteId), 0);
    assert.deepEqual(await trailSizes(tenant, websiteId), {});
    const results = await funnelResultsIn(
      {
        websiteId,
        steps: [{ kind: "url", value: "/a" }],
        conversionWindowMs: DAY,
        experiment: null,
      },
      tenant,
      { since: new Date(Date.now() - DAY), until: new Date() },
    );
    assert.equal(results.incomplete, false);
    assert.equal(results.computation.events, 0);
  });
});

describe("the backfill's reconcile walk", () => {
  useRealModels();

  test("reaches back before the start of the last one that completed", async () => {
    const tenant = "trail-reconcile";
    const websiteId = "trail-reconcile-site";
    await EnsureWebsite({
      id: websiteId,
      tenantId: tenant,
      name: websiteId,
      domain: "trail-reconcile.example",
    });
    const backfills = GetModel(FunnelTrailBackfillsModel, tenant);
    const lastStart = Date.now() - 5 * HOUR;
    await backfills.table
      .get(websiteId)
      .update({ reconcileStartedAt: lastStart })
      .run();
    const timestamp = new Date(Date.now() - 3 * HOUR);
    await GetModel(MarketingEventsModel, tenant).insertMany([
      {
        websiteId,
        timestamp,
        day: Math.floor(timestamp.getTime() / DAY) * DAY,
        kind: "pageview",
        sessionId: "lost-trail-write",
        visitorId: "lost-trail-write-visitor",
        url: "/a",
      },
    ]);
    const passStart = Date.now();
    await backfill();
    assert.deepEqual(await trailSizes(tenant, websiteId), {
      "lost-trail-write": 1,
    });
    const row = await backfills.get(websiteId);
    assert.ok((row?.reconcileStartedAt ?? 0) >= passStart);
  });
});

describe("a website created on this version", () => {
  useRealModels();

  test("reads complete before any backfill pass", async () => {
    const website = await new WebsitesController().create(
      { _id: "owner" },
      { name: "Created today", domain: "created-today.example" },
      { rawRequest: { headers: {} } },
    );
    const results = await funnelResultsIn(
      {
        websiteId: website._id,
        steps: [{ kind: "url", value: "/a" }],
        conversionWindowMs: DAY,
        experiment: null,
      },
      website.tenantId,
      { since: new Date(0), until: new Date() },
    );
    assert.equal(results.incomplete, false);
  });
});

describe("a tenant purge", () => {
  useRealModels();

  test("leaves no trail and no backfill row", async () => {
    const tenant = "trail-tenant";
    const site = await seedFixture(tenant, "trail-tenant-site", false);
    await backfill();
    assert.notDeepEqual(await trailSizes(tenant, site.website._id), {});
    const marketing = GetRegisteredHooks(Hook.TENANT_DELETED).filter(
      (hook) => hook.handler.name === "purgeTenantMarketingData",
    );
    assert.equal(marketing.length, 1);
    await marketing[0].handler(tenant);
    assert.deepEqual(await trailSizes(tenant, site.website._id), {});
    assert.deepEqual(
      await GetModel(FunnelTrailBackfillsModel, tenant).getAll(),
      [],
    );
  });
});

/**
 * @param {string} tenant
 * @param {string} websiteId
 * @param {Date} since
 */
async function assertTrailsHoldTheEvents(tenant, websiteId, since) {
  const sizes = await trailSizes(tenant, websiteId);
  assert.equal(total(sizes), await rawFunnelEventCount(tenant, websiteId));
  const funnel = {
    websiteId,
    steps: ["/a", "/b", "/c"].map((value) => ({ kind: "url", value })),
    conversionWindowMs: DAY,
    experiment: null,
  };
  const window = { since, until: new Date(Date.now()) };
  const { incomplete, ...results } = await funnelResultsIn(
    funnel,
    tenant,
    window,
  );
  assert.equal(incomplete, false);
  assert.deepEqual(
    results,
    await referenceFunnelResults(
      GetModel(MarketingEventsModel, tenant),
      funnel,
      window,
    ),
  );
}

describe("an analytics import resumed after a stop", () => {
  useRealModels();

  test("leaves the trails holding the events it kept", async function () {
    this.timeout(60_000);
    const tenant = "trail-import";
    const websiteId = "trail-import-site";
    const { batch, since } = await importStoppedOnSecondDay(tenant, websiteId);
    const resumed = await importAnalytics(batch);
    assert.equal(resumed.status, "imported");
    await backfill();
    await assertTrailsHoldTheEvents(tenant, websiteId, since);
  });

  test("while a backfill walks its events stops the walk from writing the discarded ones back", async function () {
    this.timeout(60_000);
    const tenant = "trail-import-race";
    const websiteId = "trail-import-race-site";
    const { batch, since } = await importStoppedOnSecondDay(tenant, websiteId);
    await GetModel(FunnelTrailBackfillsModel, tenant).deleteByWebsite(
      websiteId,
    );
    /** @type {string[]} */
    const resumed = [];
    const racing = mock.method(
      GetModel(FunnelTrailsModel, tenant),
      "recordMany",
      /**
       * @this {InstanceType<typeof FunnelTrailsModel>}
       * @param {string} site
       * @param {Map<string, import("../dist/db").TrailedEvent[]>} sessions
       */
      async function (site, sessions) {
        if (resumed.length === 0) {
          resumed.push((await importAnalytics(batch)).status);
        }
        return FunnelTrailsModel.prototype.recordMany.call(
          this,
          site,
          sessions,
        );
      },
    );
    await backfill();
    racing.mock.restore();
    assert.deepEqual(resumed, ["imported"]);
    await backfill();
    await assertTrailsHoldTheEvents(tenant, websiteId, since);
  });

  test("keeps a walk that began after its first fence from writing the discarded events back after the deletes", async function () {
    this.timeout(60_000);
    const tenant = "trail-import-walk";
    const websiteId = "trail-import-walk-site";
    const { batch, since } = await importStoppedOnSecondDay(tenant, websiteId);
    await GetModel(FunnelTrailBackfillsModel, tenant).deleteByWebsite(
      websiteId,
    );
    const walk = pauseTheNextFlush(tenant);
    /** @type {Promise<void> | undefined} */
    let walking;
    const deleting = mock.method(
      GetModel(MarketingEventsModel, tenant),
      "deleteImportedOnDay",
      /**
       * @this {InstanceType<typeof MarketingEventsModel>}
       * @param {string} site
       * @param {string} importId
       * @param {number} day
       */
      async function (site, importId, day) {
        if (!walking) {
          walking = backfill();
          await walk.reached;
        }
        return MarketingEventsModel.prototype.deleteImportedOnDay.call(
          this,
          site,
          importId,
          day,
        );
      },
    );
    const cleaning = mock.method(
      GetModel(MarketingSessionsModel, tenant),
      "deleteMany",
      /**
       * @this {InstanceType<typeof MarketingSessionsModel>}
       * @param {string[]} sessionIds
       */
      async function (sessionIds) {
        const deleted = await MarketingSessionsModel.prototype.deleteMany.call(
          this,
          sessionIds,
        );
        walk.release();
        await walking;
        return deleted;
      },
    );
    const resumed = await importAnalytics(batch);
    for (const mocked of [walk.pausing, deleting, cleaning]) {
      mocked.mock.restore();
    }
    assert.equal(resumed.status, "imported");
    assert.ok(walking, "the discard deleted events");
    await backfill();
    await assertTrailsHoldTheEvents(tenant, websiteId, since);
  });
});

describe("an analytics import whose discard fails mid-delete", () => {
  useRealModels();

  test("still takes a racing walk's entries for the deleted events back out", async function () {
    this.timeout(60_000);
    const tenant = "trail-import-delete-fails";
    const websiteId = "trail-import-delete-fails-site";
    const { batch } = await importStoppedOnSecondDay(tenant, websiteId);
    await GetModel(FunnelTrailBackfillsModel, tenant).deleteByWebsite(
      websiteId,
    );
    const walk = pauseTheNextFlush(tenant);
    /** @type {Promise<void> | undefined} */
    let walking;
    const deleting = mock.method(
      GetModel(MarketingEventsModel, tenant),
      "deleteImportedOnDay",
      /**
       * @this {InstanceType<typeof MarketingEventsModel>}
       * @param {string} site
       * @param {string} importId
       * @param {number} day
       */
      async function (site, importId, day) {
        walking = backfill();
        await walk.reached;
        await MarketingEventsModel.prototype.deleteImportedOnDay.call(
          this,
          site,
          importId,
          day,
        );
        walk.release();
        await walking;
        throw new Error("the delete failed");
      },
    );
    await assert.rejects(importAnalytics(batch), /the delete failed/);
    for (const mocked of [walk.pausing, deleting]) {
      mocked.mock.restore();
    }
    assert.equal(
      total(await trailSizes(tenant, websiteId)),
      await rawFunnelEventCount(tenant, websiteId),
    );
  });
});
