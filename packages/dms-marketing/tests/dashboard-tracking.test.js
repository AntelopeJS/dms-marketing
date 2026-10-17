const assert = require("node:assert/strict");
const test = it;
const { getConfig, setConfig } = require("../dist/config");
const {
  dashboardExcludedPaths,
  dashboardFrontendOptions,
  dashboardWebsiteId,
  isDashboardWebsite,
  provisionDashboardWebsite,
} = require("../dist/services/dashboard-tracking");
const {
  MAX_EXTRA_DOMAINS,
  MAX_WEBSITE_ID_LENGTH,
} = require("../dist/types/constants");

const ENABLED = {
  enabled: true,
  websiteName: "Back office",
  excludePaths: [],
};

after(() => setConfig({}));

// --- Configuration -----------------------------------------------------------

test("dashboard tracking is off unless enabled", () => {
  setConfig({});
  assert.deepEqual(getConfig().dashboardTracking, {
    enabled: false,
    websiteName: "Dashboard",
    excludePaths: [],
  });
  setConfig({ dashboardTracking: { enabled: "yes" } });
  assert.equal(getConfig().dashboardTracking.enabled, false);
});

test("the configured name and excluded paths are kept", () => {
  setConfig({
    dashboardTracking: {
      enabled: true,
      websiteName: "  Admin  ",
      excludePaths: ["/settings/**", "/modules/crm/*", "/about"],
    },
  });
  assert.deepEqual(getConfig().dashboardTracking, {
    enabled: true,
    websiteName: "Admin",
    excludePaths: ["/settings/**", "/modules/crm/*", "/about"],
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

test("the sign-in pages are always excluded, before the configured ones", () => {
  assert.deepEqual(
    dashboardExcludedPaths({ ...ENABLED, excludePaths: ["/settings/**"] }),
    ["/auth/**", "/settings/**"],
  );
  assert.deepEqual(
    dashboardExcludedPaths({ ...ENABLED, excludePaths: ["/auth/**"] }),
    ["/auth/**"],
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
        dashboardTracking: { excludePaths: ["/auth/**", "/settings/**"] },
      },
    },
  );
});

// --- Provisioning ------------------------------------------------------------

function fakeStore() {
  const rows = new Map();
  return {
    rows,
    inserts: 0,
    updates: 0,
    async get(id) {
      const row = rows.get(id);
      return row && structuredClone(row);
    },
    async insert(website) {
      if (rows.has(website._id)) {
        throw new Error("duplicate key");
      }
      this.inserts++;
      rows.set(website._id, structuredClone(website));
    },
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
  // A subdomain of an accepted host is accepted already.
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
  // The other visit inserts between this one's read and its insert.
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
