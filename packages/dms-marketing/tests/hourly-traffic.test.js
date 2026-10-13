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
  MarketingEvent,
  marketingEventsTableName,
} = require("../dist/db/tables/marketing_events.table");
const { hourlyValues } = require("../dist/services/hourly-traffic");

const SCHEMA = "hourly_traffic_test";
const TENANT = "tenant-h";
const WEBSITE = { _id: "site-h", tenantId: TENANT };
const HOUR = 3_600_000;
let client;
let events;
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

let rowCount = 0;
function event(kind, timestamp, sessionId, extra = {}) {
  rowCount += 1;
  return {
    _id: `e${rowCount}`,
    _instance: TENANT,
    websiteId: WEBSITE._id,
    kind,
    url: "/",
    sessionId,
    timestamp: new Date(timestamp),
    ...extra,
  };
}

/** A day-long window starting at a local midnight that is not a UTC hour. */
function today() {
  const since = Math.floor(Date.now() / HOUR) * HOUR - 6 * HOUR - 30 * 60_000;
  return {
    since,
    at: (hour, minutes = 0) => since + hour * HOUR + minutes * 60_000,
  };
}

/**
 * Scoped to a describe: the root hooks of the other files mock GetModel too,
 * and a root hook here would run after theirs.
 */
describe("the Today hourly series", () => {
  before(async () => {
    client = new MongoClient(process.env.TEST_MONGO_URL);
    await client.connect();
    events = client
      .db("marketing_retention")
      .collection(`${SCHEMA}__${marketingEventsTableName}`);
    const schema = new Schema(SCHEMA, {
      [marketingEventsTableName]: declared(MarketingEvent),
    });
    await DrainSchemaInitializations();
    instance = schema.instance(TENANT);
  });

  beforeEach(async () => {
    await events.deleteMany({});
    const model = new MarketingEventsModel(instance);
    mock.method(models, "GetModel", () => model);
  });

  afterEach(() => mock.restoreAll());

  after(async () => {
    await client?.close();
  });

  test("the hourly series is counted per hour of the window", async () => {
    const { since, at } = today();
    await events.insertMany([
      event("pageview", at(0), "s1"),
      event("pageview", at(0, 59), "s1"),
      // On the hour: the hour it opens, not the one it closes.
      event("pageview", at(1), "s1"),
      event("pageview", at(3, 10), "s2"),
      event("pageview", at(5), "s2"),
      // A session already open before the window counts at its first
      // pageview inside it.
      event("pageview", since - HOUR, "s3"),
      event("pageview", at(5, 1), "s3"),
      event("custom", at(2), "s1", { name: "signup" }),
      event("click", at(2), "s1"),
      event("pageview", at(2), "s9", { websiteId: "other-site" }),
      event("pageview", at(24), "s4"),
    ]);
    const series = (metric) => hourlyValues(WEBSITE, since, 24, metric);
    const pageviews = await series("pageviews");
    assert.equal(pageviews.length, 24);
    assert.deepEqual(pageviews.slice(0, 7), [2, 1, 0, 1, 0, 2, 0]);
    assert.equal(
      pageviews.reduce((a, b) => a + b),
      6,
    );
    assert.deepEqual(
      (await series("sessions")).slice(0, 7),
      [1, 0, 0, 1, 0, 1, 0],
    );
    assert.deepEqual((await series("custom-events")).slice(0, 3), [0, 0, 1]);
    assert.equal(await series("new-visitors"), null);
  });

  test("a busy day keeps its last hours", async function () {
    // Inserting past the old cap takes a few seconds.
    this.timeout(60_000);
    const { since, at } = today();
    // Past the 200 000 raw events the series used to read at most: the
    // ascending read cut the latest hours off in silence.
    const busy = 200_100;
    const batch = [];
    for (let index = 0; index < busy; index++) {
      batch.push(event("pageview", at(0, index % 60), `b${index % 500}`));
    }
    await events.insertMany(batch, { ordered: false });
    await events.insertMany([
      event("pageview", at(5), "late"),
      event("pageview", at(5, 30), "late"),
    ]);
    const pageviews = await hourlyValues(WEBSITE, since, 24, "pageviews");
    assert.equal(pageviews[0], busy);
    assert.equal(pageviews[5], 2);
    const sessions = await hourlyValues(WEBSITE, since, 24, "sessions");
    assert.equal(sessions[0], 500);
    assert.equal(sessions[5], 1);
  });
});
