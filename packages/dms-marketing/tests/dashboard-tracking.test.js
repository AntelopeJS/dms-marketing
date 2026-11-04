const assert = require("node:assert/strict");
const test = it;
const { getConfig, setConfig } = require("../dist/config");
const {
  dashboardExcludedPaths,
  dashboardFrontendOptions,
} = require("../dist/frontend-module");
const {
  dashboardWebsiteId,
  hidesDashboardPath,
  isDashboardWebsite,
  isModuleAreaPath,
  provisionDashboardWebsite,
  setSnapshotsByOwner,
} = require("../dist/services/dashboard-tracking");
const {
  MAX_EXTRA_DOMAINS,
  MAX_WEBSITE_ID_LENGTH,
} = require("../dist/types/constants");

const ENABLED = {
  enabled: true,
  websiteName: "Back office",
  excludePaths: [],
  snapshots: false,
};
const WITH_SNAPSHOTS = { ...ENABLED, snapshots: true };

after(() => setConfig({}));

test("dashboard tracking is off unless enabled", () => {
  setConfig({});
  assert.deepEqual(getConfig().dashboardTracking, {
    enabled: false,
    websiteName: "Dashboard",
    excludePaths: [],
    snapshots: false,
  });
  setConfig({ dashboardTracking: { enabled: "yes", snapshots: "yes" } });
  assert.equal(getConfig().dashboardTracking.enabled, false);
  assert.equal(getConfig().dashboardTracking.snapshots, false);
});

test("the configured name and excluded paths are kept", () => {
  setConfig({
    dashboardTracking: {
      enabled: true,
      websiteName: "  Admin  ",
      excludePaths: ["/settings/**", "/modules/crm/*", "/about"],
      snapshots: true,
    },
  });
  assert.deepEqual(getConfig().dashboardTracking, {
    enabled: true,
    websiteName: "Admin",
    excludePaths: ["/settings/**", "/modules/crm/*", "/about"],
    snapshots: true,
  });
});

test("malformed values fall back instead of reaching the tag", () => {
  setConfig({
    dashboardTracking: {
      enabled: true,
      websiteName: "x".repeat(101),
      excludePaths: [
        "/ok/**",
        "/ok/**",
        "no-slash",
        "/a*b",
        "/a,/b",
        "/with space",
        4,
      ],
    },
  });
  const tracking = getConfig().dashboardTracking;
  assert.equal(tracking.websiteName, "Dashboard");
  assert.deepEqual(tracking.excludePaths, ["/ok/**"]);
  setConfig({ dashboardTracking: { enabled: true, excludePaths: "/x" } });
  assert.deepEqual(getConfig().dashboardTracking.excludePaths, []);
});

test("the sign-in pages and the module area are always excluded, before the configured ones", () => {
  assert.deepEqual(
    dashboardExcludedPaths({ ...ENABLED, excludePaths: ["/settings/**"] }),
    ["/auth/**", "/modules/**", "/settings/**"],
  );
  assert.deepEqual(
    dashboardExcludedPaths({
      ...ENABLED,
      excludePaths: ["/auth/**", "/modules/**"],
    }),
    ["/auth/**", "/modules/**"],
  );
});

test("the frontend module registers as before while it is off", () => {
  assert.deepEqual(
    dashboardFrontendOptions({ ...ENABLED, enabled: false }),
    {},
  );
  assert.deepEqual(
    dashboardFrontendOptions({ ...ENABLED, excludePaths: ["/settings/**"] }),
    {
      configKey: "dmsMarketing",
      options: {
        dashboardTracking: {
          excludePaths: ["/auth/**", "/modules/**", "/settings/**"],
        },
      },
    },
  );
});

/** @typedef {import("../dist/db/tables/websites.table").Website} Website */
/**
 * The stored copy of a website: `structuredClone` leaves plain data, no class.
 * @typedef {{ [Field in keyof Website]: Website[Field] }} WebsiteRecord
 */

function fakeStore() {
  /** @type {Map<string, WebsiteRecord>} */
  const rows = new Map();
  return {
    rows,
    inserts: 0,
    updates: 0,
    /** @param {string} id */
    async get(id) {
      const row = rows.get(id);
      return row && structuredClone(row);
    },
    /** @param {Website} website */
    async insert(website) {
      if (rows.has(website._id)) {
        throw new Error("duplicate key");
      }
      this.inserts++;
      rows.set(website._id, structuredClone(website));
    },
    /** @param {Website} website */
    async update(website) {
      this.updates++;
      rows.set(website._id, structuredClone(website));
    },
  };
}

test("one website id per tenant, which does not reveal the tenant", () => {
  const id = dashboardWebsiteId("tenant-a");
  assert.equal(id, dashboardWebsiteId("tenant-a"));
  assert.notEqual(id, dashboardWebsiteId("tenant-b"));
  assert.ok(id.length <= MAX_WEBSITE_ID_LENGTH);
  assert.ok(!id.includes("tenant-a"));
  assert.equal(isDashboardWebsite({ _id: id, tenantId: "tenant-a" }), true);
  assert.equal(isDashboardWebsite({ _id: id, tenantId: "tenant-b" }), false);
  assert.equal(
    isDashboardWebsite({ _id: "some-uuid", tenantId: "tenant-a" }),
    false,
  );
});

test("the first visit creates the tenant's dashboard website", async () => {
  const store = fakeStore();
  const { website, changed } = await provisionDashboardWebsite(
    store,
    "tenant-a",
    "localhost",
    ENABLED,
  );
  assert.equal(changed, true);
  assert.equal(website._id, dashboardWebsiteId("tenant-a"));
  assert.equal(website.tenantId, "tenant-a");
  assert.equal(website.name, "Back office");
  assert.equal(website.domain, "localhost");
  assert.equal(website.trackingEnabled, true);
  assert.equal(website.snapshotsEnabled, false);
  assert.equal(website.snapshotsSetBy, "config");
  assert.equal(website.snapshotMaskText, true);
  assert.equal(store.inserts, 1);
});

test("later visits change nothing, and keep what an owner edited", async () => {
  const store = fakeStore();
  await provisionDashboardWebsite(store, "tenant-a", "localhost", ENABLED);
  const id = dashboardWebsiteId("tenant-a");
  store.rows.set(id, {
    ...store.rows.get(id),
    name: "Renamed",
    trackingEnabled: false,
  });
  const again = await provisionDashboardWebsite(
    store,
    "tenant-a",
    "localhost",
    { ...ENABLED, websiteName: "Other" },
  );
  assert.equal(again.changed, false);
  assert.equal(again.website.name, "Renamed");
  assert.equal(again.website.trackingEnabled, false);
  assert.equal(store.inserts, 1);
  assert.equal(store.updates, 0);
});

test("a new host the dashboard answers on joins the extra domains", async () => {
  const store = fakeStore();
  await provisionDashboardWebsite(store, "tenant-a", "localhost", ENABLED);
  const { website, changed } = await provisionDashboardWebsite(
    store,
    "tenant-a",
    "admin.example.com",
    ENABLED,
  );
  assert.equal(changed, true);
  assert.deepEqual(website.extraDomains, ["admin.example.com"]);
  const sub = await provisionDashboardWebsite(
    store,
    "tenant-a",
    "eu.admin.example.com",
    ENABLED,
  );
  assert.equal(sub.changed, false);
});

test("past the extra domains cap, a new host is left out", async () => {
  const store = fakeStore();
  await provisionDashboardWebsite(store, "tenant-a", "localhost", ENABLED);
  for (let index = 0; index < MAX_EXTRA_DOMAINS; index++) {
    await provisionDashboardWebsite(
      store,
      "tenant-a",
      `host-${index}.test`,
      ENABLED,
    );
  }
  const full = await provisionDashboardWebsite(
    store,
    "tenant-a",
    "one-more.test",
    ENABLED,
  );
  assert.equal(full.changed, false);
  assert.equal(full.website.extraDomains.length, MAX_EXTRA_DOMAINS);
});

test("two first visits at once end with one website", async () => {
  const store = fakeStore();
  const id = dashboardWebsiteId("tenant-a");
  const get = store.get.bind(store);
  store.get = async (key) => {
    const row = await get(key);
    if (!row && !store.rows.has(key)) {
      store.rows.set(key, {
        _id: id,
        tenantId: "tenant-a",
        name: "First",
        domain: "localhost",
        extraDomains: [],
      });
    }
    return row;
  };
  const { website } = await provisionDashboardWebsite(
    store,
    "tenant-a",
    "localhost",
    ENABLED,
  );
  assert.equal(website.name, "First");
  assert.equal(store.rows.size, 1);
});

test("snapshots: true provisions the website with snapshots on", async () => {
  const store = fakeStore();
  const { website, snapshotsChanged } = await provisionDashboardWebsite(
    store,
    "tenant-a",
    "localhost",
    WITH_SNAPSHOTS,
  );
  assert.equal(website.snapshotsEnabled, true);
  assert.equal(website.snapshotsSetBy, "config");
  assert.equal(website.snapshotMaskText, true);
  assert.equal(snapshotsChanged, false);
});

test("a website the configuration owns follows it both ways", async () => {
  const store = fakeStore();
  await provisionDashboardWebsite(store, "tenant-a", "localhost", ENABLED);
  const on = await provisionDashboardWebsite(
    store,
    "tenant-a",
    "localhost",
    WITH_SNAPSHOTS,
  );
  assert.equal(on.changed, true);
  assert.equal(on.snapshotsChanged, true);
  assert.equal(on.website.snapshotsEnabled, true);
  const id = dashboardWebsiteId("tenant-a");
  assert.equal(store.rows.get(id).snapshotsEnabled, true);
  const again = await provisionDashboardWebsite(
    store,
    "tenant-a",
    "localhost",
    WITH_SNAPSHOTS,
  );
  assert.equal(again.changed, false);
  const off = await provisionDashboardWebsite(
    store,
    "tenant-a",
    "localhost",
    ENABLED,
  );
  assert.equal(off.snapshotsChanged, true);
  assert.equal(store.rows.get(id).snapshotsEnabled, false);
  assert.equal(store.rows.get(id).snapshotsSetBy, "config");
});

test("an owner's snapshot choice is never overridden by the configuration", async () => {
  const store = fakeStore();
  const id = dashboardWebsiteId("tenant-a");
  const { website } = await provisionDashboardWebsite(
    store,
    "tenant-a",
    "localhost",
    WITH_SNAPSHOTS,
  );
  assert.equal(setSnapshotsByOwner(website, false), true);
  assert.equal(website.snapshotsSetBy, "owner");
  await store.update(website);
  const updates = store.updates;
  for (let visit = 0; visit < 3; visit++) {
    const next = await provisionDashboardWebsite(
      store,
      "tenant-a",
      "localhost",
      WITH_SNAPSHOTS,
    );
    assert.equal(next.changed, false);
    assert.equal(next.snapshotsChanged, false);
  }
  assert.equal(store.rows.get(id).snapshotsEnabled, false);
  assert.equal(store.updates, updates);
  const row = await store.get(id);
  setSnapshotsByOwner(row, true);
  await store.update(row);
  await provisionDashboardWebsite(store, "tenant-a", "localhost", ENABLED);
  assert.equal(store.rows.get(id).snapshotsEnabled, true);
});

test("re-saving the same snapshot value does not claim the switch", () => {
  const website = { snapshotsEnabled: true, snapshotsSetBy: "config" };
  assert.equal(setSnapshotsByOwner(website, true), false);
  assert.equal(website.snapshotsSetBy, "config");
});

const TENANT = "tenant-a";
const DASHBOARD = { _id: dashboardWebsiteId(TENANT), tenantId: TENANT };
const OTHER_SITE = { _id: "some-uuid", tenantId: TENANT };

test("the module area is the modules page, the store and every module page", () => {
  for (const path of [
    "/modules",
    "/modules/",
    "/modules/store",
    "/modules/crm/customers/42",
    "/Modules/CRM",
  ]) {
    assert.equal(isModuleAreaPath(path), true, path);
  }
  for (const path of ["/", "/modulesx", "/settings/modules", "/module"]) {
    assert.equal(isModuleAreaPath(path), false, path);
  }
});

test("only the dashboard's own website hides the module area", () => {
  assert.equal(hidesDashboardPath(DASHBOARD, "/modules/crm"), true);
  assert.equal(hidesDashboardPath(DASHBOARD, "/orders"), false);
  assert.equal(hidesDashboardPath(OTHER_SITE, "/modules/crm"), false);
});
