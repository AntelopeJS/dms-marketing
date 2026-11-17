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
} = require("../dist/db");
const { WebsitesController } = require("../dist/routes/websites");
const { importAnalytics } = require("../dist/services/analytics-import");
const { funnelResultsIn } = require("../dist/services/funnels");
const { pruneFunnelTrails, pruneRawEvents } = require("../dist/services/prune");
const {
  purgeWebsiteCollectedData,
  purgeWebsiteTrackingData,
} = require("../dist/services/tenant-website");
const { WINDOWS, at, seedFixture } = require("./helpers/funnel-fixture");
const {
  assertSameAsReference,
  backfill,
  rawFunnelEventCount,
  total,
  trailSizes,
  useRealModels,
} = require("./helpers/funnel-trail-checks");
const { referenceFunnelResults } = require("./helpers/raw-funnel-reference");

const DAY = 86_400_000;

describe("the raw events' retention", () => {
  useRealModels();
  afterEach(() => setConfig());

  test("leaves the trails counting what the events table keeps", async function () {
    this.timeout(60_000);
    const tenant = "trail-retention";
    const site = await seedFixture(tenant, "trail-retention-site");
    await backfill();
    const cutoff = at(99.5);
    setConfig({ rawEventsRetention: Date.now() - cutoff });
    await pruneRawEvents(GetModel(MarketingEventsModel, tenant));
    await pruneFunnelTrails(GetModel(FunnelTrailsModel, tenant));
    await assertSameAsReference(tenant, site);
    const trails = GetModel(FunnelTrailsModel, tenant).sessionsIn({
      websiteId: site.website._id,
      since: 0,
      until: Number.MAX_SAFE_INTEGER,
      withExposures: true,
    });
    for await (const session of trails) {
      const newest = session.events.at(-1)?.at ?? 0;
      assert.ok(
        newest >= cutoff,
        `${session.sessionId} ends before the cutoff`,
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
 * A website whose analytics import stopped on its second day, after it wrote
 * some of that day's events: what a resumed import discards.
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
     * @param {import("../dist/db").NewMarketingEvent[]} docs
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

/**
 * The trails hold every funnel event of the website and nothing else, and
 * read as the raw events do.
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
});
