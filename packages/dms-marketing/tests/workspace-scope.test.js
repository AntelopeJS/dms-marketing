const assert = require("node:assert/strict");
const { mock } = require("node:test");
const { gzipSync } = require("node:zlib");
const test = it;
const { Schema } = require("@antelopejs/interface-database/schema");
const {
  DatumStaticMetadata,
  getMetadata,
} = require("@antelopejs/interface-database-decorators/common");
const {
  DrainSchemaInitializations,
} = require("@antelopejs/mongodb/dist/schema-initialization");
const models = require("@antelopejs/interface-database-decorators/model");
const { MongoClient } = require("mongodb");
const {
  MarketingEventsModel,
} = require("../dist/db/models/marketing_events.model");
const {
  PageSnapshotsModel,
} = require("../dist/db/models/page_snapshots.model");
const {
  MarketingEvent,
  marketingEventsTableName,
} = require("../dist/db/tables/marketing_events.table");
const { dashboardWebsiteId } = require("../dist/services/dashboard-tracking");
const {
  computeClickHeatmap,
  computeScopedPageActivity,
  computeScrollDepth,
  mergeClickHeatmaps,
  mergeScrollDepths,
} = require("../dist/services/heatmap");
const {
  maskSnapshotHtml,
  readScopedPageSnapshot,
} = require("../dist/services/snapshots");
const { trailingWindow } = require("../dist/services/period");
const {
  ALL_WORKSPACES,
  listDashboardWorkspaces,
  resolveWorkspaceScope,
} = require("../dist/services/workspace-scope");

const SCHEMA = "workspace_scope_test";
const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";
const SITE_A = dashboardWebsiteId(TENANT_A);
const SITE_B = dashboardWebsiteId(TENANT_B);

function site(tenantId, id = dashboardWebsiteId(tenantId)) {
  return { _id: id, tenantId, name: "Dashboard", snapshotsEnabled: true };
}

/** The DMS core's tenants and the websites table, as the scope reads them. */
function stores(tenants, websites) {
  return {
    tenants: {
      get: async (id) => tenants.find((tenant) => tenant._id === id),
      getAll: async () => tenants,
    },
    websites: {
      getMany: async (ids) => websites.filter((row) => ids.includes(row._id)),
    },
  };
}

const TWO_WORKSPACES = stores(
  [
    { _id: TENANT_B, name: "Beta" },
    { _id: TENANT_A, name: "Alpha" },
    { _id: "tenant-c", name: "Never opened" },
  ],
  [site(TENANT_A), site(TENANT_B), site("tenant-c", "customer-site")],
);

const PLATFORM_OWNER = { owner: true, tenantId: TENANT_A };
const WORKSPACE_OWNER = { owner: false, tenantId: TENANT_A };

const notFound = (error) => error.getStatus() === 404;

describe("workspace scope guard", () => {
  test("lists the workspaces with a dashboard site to a platform owner, theirs first", async () => {
    const options = await listDashboardWorkspaces(
      TWO_WORKSPACES,
      PLATFORM_OWNER,
      site(TENANT_A),
    );
    assert.deepEqual(options, [
      { id: TENANT_A, name: "Alpha", current: true },
      { id: TENANT_B, name: "Beta", current: false },
    ]);
  });

  test("offers no selector to a workspace owner, nor on a customer website", async () => {
    assert.deepEqual(
      await listDashboardWorkspaces(
        TWO_WORKSPACES,
        WORKSPACE_OWNER,
        site(TENANT_A),
      ),
      [],
    );
    assert.deepEqual(
      await listDashboardWorkspaces(
        TWO_WORKSPACES,
        PLATFORM_OWNER,
        site(TENANT_A, "customer-site"),
      ),
      [],
    );
  });

  test("offers no selector on a single-workspace install", async () => {
    const single = stores(
      [{ _id: TENANT_A, name: "Default" }],
      [site(TENANT_A)],
    );
    assert.deepEqual(
      await listDashboardWorkspaces(single, PLATFORM_OWNER, site(TENANT_A)),
      [],
    );
  });

  test("a workspace owner cannot read another workspace, nor all of them", async () => {
    for (const workspace of [TENANT_B, ALL_WORKSPACES]) {
      await assert.rejects(
        resolveWorkspaceScope(
          TWO_WORKSPACES,
          WORKSPACE_OWNER,
          site(TENANT_A),
          workspace,
        ),
        notFound,
      );
    }
  });

  test("a platform owner widens the dashboard site only", async () => {
    await assert.rejects(
      resolveWorkspaceScope(
        TWO_WORKSPACES,
        PLATFORM_OWNER,
        site(TENANT_A, "customer-site"),
        TENANT_B,
      ),
      notFound,
    );
    await assert.rejects(
      resolveWorkspaceScope(
        TWO_WORKSPACES,
        PLATFORM_OWNER,
        site(TENANT_A),
        "tenant-c",
      ),
      notFound,
    );
    await assert.rejects(
      resolveWorkspaceScope(
        TWO_WORKSPACES,
        PLATFORM_OWNER,
        site(TENANT_A),
        "unknown",
      ),
      notFound,
    );
  });

  test("the own workspace reads as before; another one or all are foreign", async () => {
    const own = await resolveWorkspaceScope(
      TWO_WORKSPACES,
      WORKSPACE_OWNER,
      site(TENANT_A),
      TENANT_A,
    );
    assert.deepEqual(own, {
      sites: [{ tenantId: TENANT_A, website: site(TENANT_A) }],
      foreign: false,
    });
    const other = await resolveWorkspaceScope(
      TWO_WORKSPACES,
      PLATFORM_OWNER,
      site(TENANT_A),
      TENANT_B,
    );
    assert.equal(other.foreign, true);
    assert.deepEqual(
      other.sites.map((entry) => [entry.tenantId, entry.website._id]),
      [[TENANT_B, SITE_B]],
    );
    const all = await resolveWorkspaceScope(
      TWO_WORKSPACES,
      PLATFORM_OWNER,
      site(TENANT_A),
      ALL_WORKSPACES,
    );
    assert.equal(all.foreign, true);
    assert.deepEqual(all.sites.map((entry) => entry.tenantId).sort(), [
      TENANT_A,
      TENANT_B,
    ]);
  });
});

function declared(Table) {
  const indexes = Object.fromEntries(
    Object.entries(getMetadata(Table, DatumStaticMetadata).indexes).map(
      ([group, fields]) => [group, { fields }],
    ),
  );
  return { fields: {}, indexes };
}

function event(id, tenant, kind, url, data = {}) {
  return {
    _id: `${tenant}-${id}`,
    _instance: tenant,
    websiteId: dashboardWebsiteId(tenant),
    kind,
    url,
    timestamp: new Date(),
    data,
  };
}

const anchored = (dy) => ({
  x: 0.5,
  y: dy,
  dx: 0.5,
  dy,
  selector: "#save",
  ox: 0.5,
  oy: 0.5,
  nth: 0,
});

describe("combined heatmaps", () => {
  let client;
  let db;
  const instances = {};

  before(async () => {
    client = new MongoClient(process.env.TEST_MONGO_URL);
    await client.connect();
    db = client.db("marketing_retention");
    const schema = new Schema(SCHEMA, {
      [marketingEventsTableName]: declared(MarketingEvent),
    });
    await DrainSchemaInitializations();
    instances[TENANT_A] = schema.instance(TENANT_A);
    instances[TENANT_B] = schema.instance(TENANT_B);
  });

  beforeEach(async () => {
    const events = db.collection(`${SCHEMA}__marketing_events`);
    await events.deleteMany({});
    const rows = [
      event("c1", TENANT_A, "click", "/orders", anchored(0.2)),
      event("c2", TENANT_A, "click", "/orders", { x: 0.1, y: 0.9 }),
      event("c3", TENANT_B, "click", "/orders", anchored(0.25)),
      event("c4", TENANT_B, "click", "/orders", anchored(0.3)),
      event("s1", TENANT_A, "scroll", "/orders", { depth: 50 }),
      event("s2", TENANT_B, "scroll", "/orders", { depth: 100 }),
    ];
    for (let index = 0; index < 20; index++) {
      const tenant = index % 2 ? TENANT_A : TENANT_B;
      rows.push(
        event(`p${index}`, tenant, "pageview", "/orders", {
          sample: tenant === TENANT_A ? 1 : 0.5,
        }),
      );
    }
    await events.insertMany(rows);
    mock.method(
      models,
      "GetModel",
      (Model, tenantId) => new MarketingEventsModel(instances[tenantId]),
    );
  });

  afterEach(() => mock.restoreAll());

  after(async () => {
    await client?.close();
  });

  test("clicks of two workspaces merge per element and per document cell", async () => {
    const window = trailingWindow(7);
    const merged = mergeClickHeatmaps(
      await Promise.all(
        [TENANT_A, TENANT_B].map((tenant) =>
          computeClickHeatmap(
            tenant,
            [dashboardWebsiteId(tenant)],
            "/orders",
            window,
          ),
        ),
      ),
    );
    assert.equal(merged.totalClicks, 4);
    assert.equal(merged.truncated, false);
    const save = merged.points.filter((point) => point.anchor);
    assert.equal(save.length, 1, "one element, one cell, whatever workspace");
    assert.equal(save[0].weight, 3);
    assert.equal(merged.maxWeight, 3);
    assert.equal(merged.points.length, 2);
  });

  test("scroll depth and page activity add up across workspaces", async () => {
    const window = trailingWindow(7);
    const depth = mergeScrollDepths(
      await Promise.all(
        [TENANT_A, TENANT_B].map((tenant) =>
          computeScrollDepth(
            tenant,
            [dashboardWebsiteId(tenant)],
            "/orders",
            window,
          ),
        ),
      ),
    );
    assert.equal(depth.views, 2);
    assert.equal(depth.reached[0], 2);
    assert.equal(depth.reached[50], 2);
    assert.equal(depth.reached[100], 1);

    const activity = await computeScopedPageActivity(
      [
        { tenantId: TENANT_A, websiteId: SITE_A },
        { tenantId: TENANT_B, websiteId: SITE_B },
      ],
      window,
    );
    assert.equal(activity.clicks.get("/orders"), 4);
    assert.equal(activity.sampled.get("/orders"), 2);
    // 10 pageviews at 1 and 10 at 0.5: neither site alone reaches the
    // 20 pageviews a measured rate needs, together they do.
    assert.equal(activity.sampleRate, 0.75);
  });

  test("an empty scroll merge stays empty", () => {
    assert.deepEqual(mergeScrollDepths([]), {
      views: 0,
      reached: [],
      truncated: false,
    });
  });
});

describe("foreign backdrops", () => {
  const PAGE = `<!DOCTYPE html><html><head><title>Acme invoices</title><style>.total::after{content:"";} a < b</style></head><body><h1 class="title">Invoice for Jane Doe</h1><p>Total: 1&nbsp;234,56 &euro;</p><img src="https://example.com/a.png" alt="Jane's avatar"><button aria-label="Pay Jane">Pay</button><input placeholder="Search Jane"></body></html>`;

  test("masks every text and text attribute, keeps structure and styles", () => {
    const masked = maskSnapshotHtml(PAGE);
    for (const secret of ["Jane", "Acme", "234", "euro", "Pay", "Search"]) {
      assert.equal(masked.includes(secret), false, secret);
    }
    assert.match(masked, /<h1 class="title">xxxxxxx xxx xxxx xxx<\/h1>/);
    assert.match(masked, /\.total::after\{content:"";\} a < b/);
    assert.match(masked, /src="https:\/\/example.com\/a.png"/);
    assert.match(
      masked,
      /^<!DOCTYPE html><meta http-equiv="Content-Security-Policy"/,
    );
  });

  function captureRow(layout, capturedAt, html) {
    return {
      layout,
      capturedAt: new Date(capturedAt),
      origin: "https://app.example.com",
      url: "/orders",
      viewportWidth: 1280,
      viewportHeight: 800,
      documentWidth: 1280,
      documentHeight: 2000,
      bytes: html.length,
      html: gzipSync(html).toString("base64"),
    };
  }

  test("combined mode sends the newest capture of the asked layout, masked", async () => {
    const rows = {
      [TENANT_A]: [captureRow("desktop", 1000, "<p>Alpha secret</p>")],
      [TENANT_B]: [
        captureRow("desktop", 2000, "<p>Beta secret</p>"),
        captureRow("phone", 3000, "<p>Beta phone</p>"),
      ],
    };
    mock.method(models, "GetModel", (Model, tenantId) => {
      assert.equal(Model, PageSnapshotsModel);
      return { getByPath: async () => [...rows[tenantId]] };
    });
    try {
      const sites = [
        { tenantId: TENANT_A, websiteId: SITE_A },
        { tenantId: TENANT_B, websiteId: SITE_B },
      ];
      const combined = await readScopedPageSnapshot(
        sites,
        "/orders",
        "desktop",
        true,
      );
      assert.equal(combined.capturedAt, 2000);
      assert.equal(combined.masked, true);
      assert.equal(combined.html.includes("secret"), false);
      assert.match(combined.html, /<p>xxxx xxxxxx<\/p>/);

      const own = await readScopedPageSnapshot(
        sites.slice(0, 1),
        "/orders",
        "desktop",
        false,
      );
      assert.equal(own.masked, undefined);
      assert.equal(own.html, "<p>Alpha secret</p>");
    } finally {
      mock.restoreAll();
    }
  });
});
