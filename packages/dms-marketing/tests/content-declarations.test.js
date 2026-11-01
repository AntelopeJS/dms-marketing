const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const { FunnelsModel, WebsitesModel } = require("../dist/db");
const { ensureWebsite } = require("../dist/services/declared-website");
const { ensureFunnel } = require("../dist/services/declared-funnel");
const { dashboardWebsiteId } = require("../dist/services/dashboard-tracking");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Rows by id, handed out as copies: the services mutate what they read. */
function table() {
  const rows = new Map();
  return {
    rows,
    async get(id) {
      const row = rows.get(id);
      return row && structuredClone(row);
    },
    async insert(row) {
      if (rows.has(row._id)) {
        throw new Error("duplicate key");
      }
      rows.set(row._id, structuredClone(row));
    },
    async update(row, patch) {
      if (patch === undefined) {
        rows.set(row._id, structuredClone(row));
      } else {
        rows.set(row, { ...rows.get(row), ...structuredClone(patch) });
      }
    },
  };
}

let websites;
let funnelsByTenant;

function funnelsOf(tenantId) {
  if (!funnelsByTenant.has(tenantId)) {
    const funnels = table();
    funnels.hasKey = async (websiteId, key, excludeId) =>
      [...funnels.rows.values()].some(
        (row) =>
          row.websiteId === websiteId &&
          row.experiment?.key === key &&
          row._id !== excludeId,
      );
    funnelsByTenant.set(tenantId, funnels);
  }
  return funnelsByTenant.get(tenantId);
}

/**
 * Scoped to each describe: a root hook would mock GetModel for every other
 * file of the suite too.
 */
function useFakeModels() {
  beforeEach(() => {
    websites = table();
    websites.getByTenant = async (tenantId) =>
      [...websites.rows.values()].filter((row) => row.tenantId === tenantId);
    funnelsByTenant = new Map();
    mock.method(models, "GetModel", (Model, tenantId) => {
      if (Model === WebsitesModel) {
        return websites;
      }
      if (Model === FunnelsModel) {
        return funnelsOf(tenantId);
      }
      throw new Error(`unexpected model ${Model.name}`);
    });
  });

  afterEach(() => mock.restoreAll());
}

const SITE = {
  tenantId: "default",
  id: "shop-site",
  name: "Shop",
  domain: "https://Shop.Example.com/home",
};

/** What a user does from the dashboard: edit the stored row directly. */
function userEdits(store, id, patch) {
  store.rows.set(id, { ...store.rows.get(id), ...patch });
}

describe("EnsureWebsite", () => {
  useFakeModels();

  test("creates the website under the declared id, in the default tenant", async () => {
    assert.deepEqual(await ensureWebsite(SITE), {
      id: "shop-site",
      status: "created",
    });
    const row = websites.rows.get("shop-site");
    assert.equal(row.tenantId, "default");
    assert.equal(row.domain, "shop.example.com");
    assert.equal(row.trackingEnabled, true);
    assert.equal(row.snapshotsEnabled, false);
  });

  test("a declared id is kept, whatever is declared next", async () => {
    await ensureWebsite(SITE);
    userEdits(websites, "shop-site", { trackingEnabled: false });
    const before = websites.rows.get("shop-site");
    const result = await ensureWebsite({
      ...SITE,
      name: "Renamed by code",
      snapshotsEnabled: true,
    });
    assert.deepEqual(result, { id: "shop-site", status: "kept" });
    assert.deepEqual(websites.rows.get("shop-site"), before);
  });

  test("a site made in the dashboard is never taken over", async () => {
    websites.rows.set("hand-made", {
      _id: "hand-made",
      tenantId: "default",
      name: "Hand made",
      domain: "hand.example.com",
      trackingEnabled: true,
    });
    const result = await ensureWebsite({ ...SITE, id: "hand-made" });
    assert.equal(result.status, "kept");
    assert.equal(websites.rows.get("hand-made").name, "Hand made");
  });

  test("an id of another tenant, a bad id or a bad domain is refused", async () => {
    await ensureWebsite({ ...SITE, tenantId: "tenant-a" });
    await assert.rejects(
      ensureWebsite({ ...SITE, tenantId: "tenant-b" }),
      /EnsureWebsite\("shop-site"\): this id already names a website of another tenant/,
    );
    await assert.rejects(
      ensureWebsite({ ...SITE, id: "-bad id" }),
      /the id must be 1-64 letters/,
    );
    await assert.rejects(
      ensureWebsite({ ...SITE, id: "other", domain: "not a domain!!" }),
      /domain: not a hostname/,
    );
  });

  test("a host another site of the tenant declares is refused, the dashboard's excepted", async () => {
    await ensureWebsite(SITE);
    await assert.rejects(
      ensureWebsite({ ...SITE, id: "copy", domain: "shop.example.com" }),
      /the host "shop.example.com" is already declared by the website "Shop"/,
    );
    const dashboard = dashboardWebsiteId("default");
    websites.rows.set(dashboard, {
      _id: dashboard,
      tenantId: "default",
      name: "Dashboard",
      domain: "localhost",
    });
    const result = await ensureWebsite({
      ...SITE,
      id: "local",
      domain: "localhost",
    });
    assert.equal(result.status, "created");
  });
});

const FUNNEL = {
  tenantId: "default",
  id: "quote-request",
  websiteId: "shop-site",
  name: "Quote request",
  steps: [
    { kind: "url", value: "https://shop.example.com/pricing/?x=1" },
    { kind: "custom", value: "quote_submitted" },
  ],
};

const SPLIT = {
  key: "hero-cta",
  variations: [
    { key: "control", weight: 1 },
    { key: "bold", weight: 1 },
  ],
};

describe("EnsureFunnel", () => {
  useFakeModels();

  beforeEach(async () => {
    await ensureWebsite(SITE);
  });

  test("creates a plain funnel with normalized steps and the default window", async () => {
    assert.deepEqual(await ensureFunnel(FUNNEL), {
      id: "quote-request",
      status: "created",
    });
    const row = funnelsOf("default").rows.get("quote-request");
    assert.deepEqual(row.steps, [
      { kind: "url", value: "/pricing" },
      { kind: "custom", value: "quote_submitted" },
    ]);
    assert.equal(row.conversionWindowMs, 24 * HOUR);
    assert.equal(row.experiment, null);
  });

  test("a running split starts its run at the declared instant", async () => {
    const startedAt = Date.now() - 30 * DAY;
    await ensureFunnel({
      ...FUNNEL,
      experiment: { ...SPLIT, status: "running", startedAt },
    });
    const { experiment } = funnelsOf("default").rows.get("quote-request");
    assert.equal(experiment.status, "running");
    assert.deepEqual(experiment.runs, [{ startedAt, stoppedAt: null }]);
  });

  test("a split can be declared already finished", async () => {
    const startedAt = new Date(Date.now() - 20 * DAY).toISOString();
    const stoppedAt = Date.now() - 5 * DAY;
    await ensureFunnel({
      ...FUNNEL,
      experiment: { ...SPLIT, status: "stopped", startedAt, stoppedAt },
    });
    const { experiment } = funnelsOf("default").rows.get("quote-request");
    assert.deepEqual(experiment.runs, [
      { startedAt: Date.parse(startedAt), stoppedAt },
    ]);
  });

  test("a run that starts in the future or ends before it starts is refused", async () => {
    await assert.rejects(
      ensureFunnel({
        ...FUNNEL,
        experiment: {
          ...SPLIT,
          status: "running",
          startedAt: Date.now() + DAY,
        },
      }),
      /experiment.startedAt: not a past instant/,
    );
    await assert.rejects(
      ensureFunnel({
        ...FUNNEL,
        experiment: {
          ...SPLIT,
          status: "stopped",
          startedAt: Date.now() - DAY,
          stoppedAt: Date.now() - 2 * DAY,
        },
      }),
      /experiment.stoppedAt: before experiment.startedAt/,
    );
  });
});

describe("EnsureFunnel on an existing funnel", () => {
  useFakeModels();

  beforeEach(async () => {
    await ensureWebsite(SITE);
  });

  test("a declared id is kept, whatever is declared next", async () => {
    await ensureFunnel(FUNNEL);
    userEdits(funnelsOf("default"), "quote-request", { name: "Edited" });
    const before = funnelsOf("default").rows.get("quote-request");
    const result = await ensureFunnel({
      ...FUNNEL,
      conversionWindowHours: 72,
      experiment: { ...SPLIT, status: "running" },
    });
    assert.deepEqual(result, { id: "quote-request", status: "kept" });
    assert.deepEqual(funnelsOf("default").rows.get("quote-request"), before);
  });

  test("unknown websites, foreign websites, taken keys and bad steps are refused", async () => {
    await assert.rejects(
      ensureFunnel({ ...FUNNEL, websiteId: "nowhere" }),
      /no website "nowhere" in the tenant "default"/,
    );
    await assert.rejects(
      ensureFunnel({ ...FUNNEL, tenantId: "tenant-b" }),
      /no website "shop-site" in the tenant "tenant-b"/,
    );
    await ensureFunnel({ ...FUNNEL, experiment: SPLIT });
    await assert.rejects(
      ensureFunnel({ ...FUNNEL, id: "other", experiment: SPLIT }),
      /already uses the experiment key "hero-cta"/,
    );
    await assert.rejects(
      ensureFunnel({ ...FUNNEL, id: "empty", steps: [] }),
      /EnsureFunnel\("empty"\): steps:/,
    );
  });
});
