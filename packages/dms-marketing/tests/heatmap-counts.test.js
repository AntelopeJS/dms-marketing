const assert = require("node:assert/strict");
const { mock } = require("node:test");
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
  computePageActivity,
  countHeatmapData,
  resetHeatmap,
} = require("../dist/services/heatmap");
const {
  MarketingEvent,
  marketingEventsTableName,
} = require("../dist/db/tables/marketing_events.table");
const {
  PageSnapshot,
  pageSnapshotsTableName,
} = require("../dist/db/tables/page_snapshots.table");
const { trailingWindow } = require("../dist/services/period");

const SCHEMA = "heatmap_counts_test";
const TENANT = "tenant-a";
const SITE = "site-a";
const OTHER_SITE = "site-b";
let client;
let db;
let instance;

/** A table as the module declares it: a grouped read needs its schema. */
function declared(Table) {
  const indexes = Object.fromEntries(
    Object.entries(getMetadata(Table, DatumStaticMetadata).indexes).map(
      ([group, fields]) => [group, { fields }],
    ),
  );
  return { fields: {}, indexes };
}

function collection(table) {
  return db.collection(`${SCHEMA}__${table}`);
}

function event(id, kind, url, extra = {}) {
  return {
    _id: id,
    _instance: TENANT,
    websiteId: SITE,
    kind,
    url,
    timestamp: new Date(),
    data: {},
    ...extra,
  };
}

function snapshot(id, url, websiteId = SITE) {
  return { _id: id, _instance: TENANT, websiteId, url, capturedAt: new Date() };
}

before(async () => {
  client = new MongoClient(process.env.TEST_MONGO_URL);
  await client.connect();
  db = client.db("marketing_retention");
  const schema = new Schema(SCHEMA, {
    [marketingEventsTableName]: declared(MarketingEvent),
    [pageSnapshotsTableName]: declared(PageSnapshot),
  });
  await DrainSchemaInitializations();
  instance = schema.instance(TENANT);
});

beforeEach(async () => {
  await collection("marketing_events").deleteMany({});
  await collection("marketing_page_snapshots").deleteMany({});
  const events = new MarketingEventsModel(instance);
  const snapshots = new PageSnapshotsModel(instance);
  mock.method(models, "GetModel", (Model) =>
    Model === MarketingEventsModel ? events : snapshots,
  );
});

afterEach(() => mock.restoreAll());

after(async () => {
  await client?.close();
});

test("a page reset deletes exactly what its dialog counted", async () => {
  await collection("marketing_events").insertMany([
    event("c1", "click", "/a"),
    event("c2", "click", "/a"),
    event("s1", "scroll", "/a"),
    event("p1", "pageview", "/a"),
    event("c3", "click", "/b"),
    event("c4", "click", "/a", { websiteId: OTHER_SITE }),
    event("old", "scroll", "/a", { timestamp: new Date(0) }),
  ]);
  await collection("marketing_page_snapshots").insertMany([
    snapshot("n1", "/a"),
    snapshot("n2", "/b"),
    snapshot("n3", "/a", OTHER_SITE),
  ]);

  const counted = await countHeatmapData(TENANT, SITE, "/a");
  assert.deepEqual(counted, { events: 4, snapshots: 1 });
  assert.deepEqual(await resetHeatmap(TENANT, SITE, "/a"), counted);
  assert.deepEqual(
    (
      await collection("marketing_events").find().sort({ _id: 1 }).toArray()
    ).map((row) => row._id),
    ["c3", "c4", "p1"],
  );

  const site = await countHeatmapData(TENANT, SITE);
  assert.deepEqual(site, { events: 1, snapshots: 1 });
  assert.deepEqual(await resetHeatmap(TENANT, SITE), site);
});

test("page activity counts clicks and sampled views per path, and reads the declared rate", async () => {
  const rows = [
    event("c1", "click", "/a"),
    event("c2", "click", "/a"),
    event("s1", "scroll", "/a", { data: { depth: 40 } }),
    event("s2", "scroll", "/b", { data: { depth: 0 } }),
    event("old", "click", "/a", { timestamp: new Date(0) }),
  ];
  for (let index = 0; index < 8; index++) {
    rows.push(event(`p${index}`, "pageview", index % 2 ? "/a" : "/b"));
  }
  await collection("marketing_events").insertMany(rows);
  const window = trailingWindow(7);

  const quiet = await computePageActivity(TENANT, SITE, window);
  assert.equal(quiet.clicks.get("/a"), 2);
  assert.equal(quiet.sampled.get("/a"), 1);
  assert.equal(quiet.sampled.get("/b"), 1);
  assert.equal(quiet.sampleRate, null);

  const more = [event("forged", "pageview", "/b", { data: { sample: "1" } })];
  for (let index = 8; index < 48; index++) {
    const sample = index < 38 ? 1 : 0.5;
    more.push(event(`p${index}`, "pageview", "/b", { data: { sample } }));
  }
  await collection("marketing_events").insertMany(more);
  const busy = await computePageActivity(TENANT, SITE, trailingWindow(7));
  assert.equal(busy.sampleRate, (30 + 10 * 0.5) / 40);
});
