const assert = require("node:assert/strict");
const { mock } = require("node:test");
const { isDeepStrictEqual } = require("node:util");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const {
  FunnelsModel,
  PageSnapshotsModel,
  WebsitesModel,
} = require("../dist/db");
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
    async compareDeclared(expected, patch) {
      if (!isDeepStrictEqual(rows.get(expected._id), expected)) return false;
      rows.set(expected._id, { ...expected, ...structuredClone(patch) });
      return true;
    },
    async update(row, patch) {
      if (typeof row === "string") {
        rows.set(row, { ...rows.get(row), ...structuredClone(patch) });
      } else {
        rows.set(row._id, structuredClone(row));
      }
    },
  };
}

let websites;
let funnelsByTenant;
let snapshotDeletes;

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
    snapshotDeletes = [];
    mock.method(models, "GetModel", (Model, tenantId) => {
      if (Model === WebsitesModel) {
        return websites;
      }
      if (Model === FunnelsModel) {
        return funnelsOf(tenantId);
      }
      if (Model === PageSnapshotsModel) {
        return {
          async deleteByWebsite(websiteId) {
            snapshotDeletes.push(websiteId);
            return 0;
          },
        };
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
    assert.equal(typeof row.declaredHash, "string");
  });

  test("a repeated declaration writes nothing", async () => {
    await ensureWebsite(SITE);
    const before = websites.rows.get("shop-site");
    assert.equal((await ensureWebsite(SITE)).status, "unchanged");
    assert.deepEqual(websites.rows.get("shop-site"), before);
  });

  test("a new declaration refreshes a site nobody touched", async () => {
    await ensureWebsite(SITE);
    const result = await ensureWebsite({
      ...SITE,
      name: "Main Shop",
      extraDomains: ["localhost", "shop.example.com"],
      snapshotsEnabled: true,
    });
    assert.equal(result.status, "updated");
    const row = websites.rows.get("shop-site");
    assert.equal(row.name, "Main Shop");
    assert.deepEqual(row.extraDomains, ["localhost"]);
    assert.deepEqual(snapshotDeletes, ["shop-site"]);
  });

  test("a site a user changed is kept, whatever is declared next", async () => {
    await ensureWebsite(SITE);
    userEdits(websites, "shop-site", { trackingEnabled: false });
    const result = await ensureWebsite({ ...SITE, name: "Renamed by code" });
    assert.equal(result.status, "kept");
    const row = websites.rows.get("shop-site");
    assert.equal(row.name, "Shop");
    assert.equal(row.trackingEnabled, false);
    userEdits(websites, "shop-site", { trackingEnabled: true });
    assert.equal(
      (await ensureWebsite({ ...SITE, name: "New default" })).status,
      "kept",
    );
    assert.equal(websites.rows.get("shop-site").name, "Shop");
  });

  test("a site never declared from code is never taken over", async () => {
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
    assert.equal((await ensureFunnel(FUNNEL)).status, "unchanged");
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
    // The instant is only read by the move that starts the run.
    const again = await ensureFunnel({
      ...FUNNEL,
      experiment: { ...SPLIT, status: "running", startedAt: Date.now() },
    });
    assert.equal(again.status, "unchanged");
  });

  test("a split can be declared already finished, then stopped and resumed", async () => {
    const startedAt = new Date(Date.now() - 20 * DAY).toISOString();
    const stoppedAt = Date.now() - 5 * DAY;
    await ensureFunnel({
      ...FUNNEL,
      experiment: { ...SPLIT, status: "stopped", startedAt, stoppedAt },
    });
    const runs = () =>
      funnelsOf("default").rows.get("quote-request").experiment.runs;
    assert.deepEqual(runs(), [{ startedAt: Date.parse(startedAt), stoppedAt }]);
    await ensureFunnel({
      ...FUNNEL,
      experiment: { ...SPLIT, status: "running" },
    });
    assert.equal(runs().length, 2);
    assert.equal(runs()[1].stoppedAt, null);
  });

  test("the lifecycle and the frozen arms hold as on the dashboard", async () => {
    await ensureFunnel({
      ...FUNNEL,
      experiment: { ...SPLIT, status: "running" },
    });
    await assert.rejects(
      ensureFunnel({
        ...FUNNEL,
        experiment: {
          ...SPLIT,
          status: "running",
          variations: [...SPLIT.variations, { key: "third", weight: 1 }],
        },
      }),
      /its key, variations and website can no longer change/,
    );
    await assert.rejects(
      ensureFunnel({ ...FUNNEL, experiment: { ...SPLIT, status: "draft" } }),
      /cannot move from running to draft/,
    );
    await assert.rejects(
      ensureFunnel({
        ...FUNNEL,
        id: "fresh",
        experiment: {
          ...SPLIT,
          status: "running",
          startedAt: Date.now() + DAY,
        },
      }),
      /experiment.startedAt: not a past instant/,
    );
  });
});

describe("EnsureFunnel on an existing funnel", () => {
  useFakeModels();

  beforeEach(async () => {
    await ensureWebsite(SITE);
  });

  test("a funnel a user changed is kept", async () => {
    await ensureFunnel(FUNNEL);
    userEdits(funnelsOf("default"), "quote-request", { name: "Edited" });
    const result = await ensureFunnel({ ...FUNNEL, name: "Declared again" });
    assert.equal(result.status, "kept");
    assert.equal(funnelsOf("default").rows.get("quote-request").name, "Edited");
    userEdits(funnelsOf("default"), "quote-request", { name: FUNNEL.name });
    assert.equal(
      (await ensureFunnel({ ...FUNNEL, name: "New default" })).status,
      "kept",
    );
    assert.equal(
      funnelsOf("default").rows.get("quote-request").name,
      FUNNEL.name,
    );
  });

  test("a changed declaration of an untouched funnel is applied", async () => {
    await ensureFunnel(FUNNEL);
    const result = await ensureFunnel({
      ...FUNNEL,
      conversionWindowHours: 72,
      experiment: SPLIT,
    });
    assert.equal(result.status, "updated");
    const row = funnelsOf("default").rows.get("quote-request");
    assert.equal(row.conversionWindowMs, 72 * HOUR);
    assert.equal(row.experiment.status, "draft");
    assert.deepEqual(row.experiment.runs, []);
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
