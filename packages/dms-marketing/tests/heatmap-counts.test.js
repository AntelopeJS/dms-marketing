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
  computeClickHeatmap,
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
const { clickDataSchema } = require("../dist/types/events");
const {
  HEATMAP_DIVISIONS_PER_AXIS,
  MAX_ANCHORED_HEATMAP_CELLS,
} = require("../dist/types/constants");

const SCHEMA = "heatmap_counts_test";
const TENANT = "tenant-a";
const SITE = "site-a";
const OTHER_SITE = "site-b";
/** @type {MongoClient | undefined} */
let client;
/** @type {ReturnType<MongoClient["db"]>} */
let db;
/** @type {ReturnType<Schema["instance"]>} */
let instance;

/**
 * A table as the module declares it: a grouped read needs its schema.
 * @param {typeof MarketingEvent | typeof PageSnapshot} Table
 */
function declared(Table) {
  const indexes = Object.fromEntries(
    Object.entries(getMetadata(Table, DatumStaticMetadata).indexes).map(
      ([group, fields]) => [group, { fields }],
    ),
  );
  return { fields: {}, indexes };
}

/** @param {string} table */
function collection(table) {
  return db.collection(`${SCHEMA}__${table}`);
}

/**
 * @param {string} id
 * @param {MarketingEvent["kind"]} kind
 * @param {string} url
 * @param {Partial<Pick<MarketingEvent, "websiteId" | "timestamp" | "data">>} [extra]
 */
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

/**
 * @param {string} id
 * @param {string} url
 * @param {string} [websiteId]
 */
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
  mock.method(
    models,
    "GetModel",
    /** @param {Parameters<typeof models.GetModel>[0]} Model */ (Model) =>
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

test("the click heatmap skips stored rows that are not click-shaped", async () => {
  await collection("marketing_events").insertMany([
    event("valid", "click", "/a", { data: { x: 0.5, y: 0.5 } }),
    event("legacy", "click", "/a", {
      data: { x: 0.2, y: 0.3, ox: 0.1, oy: 0.1, selector: 42, nth: "two" },
    }),
  ]);

  const heatmap = await computeClickHeatmap(
    TENANT,
    [SITE],
    "/a",
    trailingWindow(7),
  );

  assert.equal(heatmap.totalClicks, 1);
  assert.equal(heatmap.points.length, 1);
  assert.equal(heatmap.points[0].weight, 1);
  assert.equal(heatmap.points[0].anchor, undefined);
});

/**
 * The heatmap as it was bucketed in JS before the query counted it: each row
 * parsed by the click schema, then folded in timestamp order.
 * @param {Array<{ data: unknown }>} rows
 */
function bucketedInJs(rows) {
  const divisions = HEATMAP_DIVISIONS_PER_AXIS;
  /** @param {number} value */
  const grid = (value) => Math.min(Math.round(value * divisions), divisions);
  /** @type {Map<string, import("@antelopejs/interface-dms-marketing").MarketingHeatmapPoint>} */
  const cells = new Map();
  /** @param {number} x @param {number} y @param {number} weight */
  const addToDocument = (x, y, weight) => {
    const key = `d:${grid(x)}:${grid(y)}`;
    const cell = cells.get(key) ?? {
      x: grid(x) / divisions,
      y: grid(y) / divisions,
      weight: 0,
    };
    cell.weight += weight;
    cells.set(key, cell);
  };
  let totalClicks = 0;
  for (const row of rows) {
    const parsed = clickDataSchema.safeParse(row.data);
    if (!parsed.success) {
      continue;
    }
    const data = parsed.data;
    const x = data.dx ?? data.x;
    const y = data.dy ?? data.y;
    totalClicks++;
    if (data.selector && data.ox !== undefined && data.oy !== undefined) {
      const nth = data.nth ?? 0;
      const key = `a:${data.selector}:${nth}:${grid(data.ox)}:${grid(data.oy)}`;
      const cell = cells.get(key) ?? {
        x,
        y,
        weight: 0,
        anchor: {
          selector: data.selector,
          ox: grid(data.ox) / divisions,
          oy: grid(data.oy) / divisions,
          nth,
        },
      };
      cell.weight++;
      cells.set(key, cell);
    } else {
      addToDocument(x, y, 1);
    }
  }
  const anchored = [...cells].filter(([, cell]) => cell.anchor);
  if (anchored.length > MAX_ANCHORED_HEATMAP_CELLS) {
    anchored.sort((a, b) => b[1].weight - a[1].weight);
    for (const [key, cell] of anchored.slice(MAX_ANCHORED_HEATMAP_CELLS)) {
      cells.delete(key);
      addToDocument(cell.x, cell.y, cell.weight);
    }
  }
  const points = [...cells.values()];
  return {
    points,
    maxWeight: points.reduce((top, point) => Math.max(top, point.weight), 0),
    totalClicks,
    truncated: false,
  };
}

test("the click heatmap counted in the query equals the one bucketed in JS, cell order and cap ties included", async () => {
  const start = Date.now() - 3 * 24 * 60 * 60 * 1000;
  /** @type {unknown[]} */
  const payloads = [
    { x: 0.01, y: 0.03 },
    { x: 0.05, y: 0.07 },
    { x: 0.2, y: 0.2, dx: 0.41, dy: 0.99 },
    { x: 0.2, y: 0.2, dx: 0.41 },
    { x: 1, y: 1 },
    { x: 0, y: 0, selector: "", ox: 0.5, oy: 0.5 },
    { x: 0.3, y: 0.3, selector: "#no-offset", ox: 0.5 },
    { x: 0.3, y: 0.31, selector: "#hero", ox: 0.01, oy: 0.03, nth: 2 },
    { x: 0.6, y: 0.61, selector: "#hero", ox: 0.011, oy: 0.029, nth: 2 },
    { x: 0.7, y: 0.71, selector: "#hero", ox: 0.01, oy: 0.03 },
    { x: 0.8, y: 0.8, dx: 0.12, dy: 0.13, selector: "#cta", ox: 1, oy: 0 },
    { x: 0.8, y: 0.8, selector: "#cta", ox: 1, oy: 0 },
    { x: 0.8, y: 0.8, selector: "#cta", ox: 1, oy: 0 },
    { x: "0.5", y: 0.5 },
    { x: 0.5, y: 0.5, dx: null },
    { x: 0.5, y: 0.5, dx: Number.NaN },
    { x: 0.5, y: 0.5, dy: Number.POSITIVE_INFINITY },
    { x: 0.5, y: 1.5 },
    { x: 0.5, y: 0.5, selector: 42, ox: 0.1, oy: 0.1 },
    { x: 0.5, y: 0.5, selector: { a: 1 }, ox: 0.1, oy: 0.1 },
    { x: 0.5, y: 0.5, selector: ["#a"], ox: 0.1, oy: 0.1 },
    { x: 0.5, y: 0.5, selector: true, ox: 0.1, oy: 0.1 },
    { x: 0.5, y: 0.5, selector: "#".repeat(121), ox: 0.1, oy: 0.1 },
    { x: 0.5, y: 0.5, selector: "#".repeat(120), ox: 0.1, oy: 0.1 },
    { x: 0.5, y: 0.5, selector: "#ok", ox: 0.1, oy: 0.1, nth: "two" },
    { x: 0.5, y: 0.5, selector: "#ok", ox: 0.1, oy: 0.1, nth: 1.5 },
    { x: 0.5, y: 0.5, selector: "#ok", ox: 0.1, oy: 0.1, nth: -1 },
    { x: 0.5, y: 0.5, selector: "#ok", ox: 2, oy: 0.1 },
    "not an object",
    [0.5, 0.5],
    null,
  ];
  for (let index = 0; index < MAX_ANCHORED_HEATMAP_CELLS + 5; index++) {
    const point = ((index * 37) % 101) / 100;
    payloads.push({
      x: point,
      y: 1 - point,
      selector: `#item-${index % (MAX_ANCHORED_HEATMAP_CELLS + 3)}`,
      ox: 0.5,
      oy: 0.5,
    });
  }
  const rows = payloads.map((data, index) =>
    event(`r${index}`, "click", "/a", {
      timestamp: new Date(start + index * 1000),
      data,
    }),
  );
  const shuffled = rows
    .map((row, index) => ({ row, order: (index * 7919) % rows.length }))
    .sort((a, b) => a.order - b.order)
    .map(({ row }) => row);
  await collection("marketing_events").insertMany([
    ...shuffled,
    event("other-path", "click", "/b", { data: { x: 0.5, y: 0.5 } }),
    event("other-kind", "scroll", "/a", { data: { x: 0.5, y: 0.5 } }),
    event("too-old", "click", "/a", {
      timestamp: new Date(0),
      data: { x: 0.5, y: 0.5 },
    }),
  ]);

  const heatmap = await computeClickHeatmap(
    TENANT,
    [SITE],
    "/a",
    trailingWindow(7),
  );
  const expected = bucketedInJs(
    await collection("marketing_events")
      .find({ kind: "click", url: "/a", timestamp: { $gt: new Date(0) } })
      .sort({ timestamp: 1 })
      .toArray(),
  );

  assert.ok(
    expected.points.filter((point) => point.anchor).length ===
      MAX_ANCHORED_HEATMAP_CELLS,
  );
  assert.deepStrictEqual(heatmap, expected);
});

test("the click heatmap counts every click of the window, past the 50,000 rows a read used to stop at", async () => {
  const clicks = 50_001;
  const start = Date.now() - 24 * 60 * 60 * 1000;
  await collection("marketing_events").insertMany(
    Array.from({ length: clicks }, (_, index) =>
      event(`c${index}`, "click", "/a", {
        timestamp: new Date(start + index),
        data: { x: index % 2 ? 0.25 : 0.75, y: 0.5 },
      }),
    ),
  );

  const heatmap = await computeClickHeatmap(
    TENANT,
    [SITE],
    "/a",
    trailingWindow(7),
  );

  assert.equal(heatmap.totalClicks, clicks);
  assert.equal(heatmap.truncated, false);
  assert.deepStrictEqual(
    heatmap.points.map((point) => point.weight).sort((a, b) => a - b),
    [25_000, 25_001],
  );
  await collection("marketing_events").drop();
});
