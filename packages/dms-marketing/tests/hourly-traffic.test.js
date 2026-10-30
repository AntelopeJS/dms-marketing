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
const { internal } = require("@antelopejs/interface-mongodb");
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
/** @type {ReturnType<Schema["instance"]>} */
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
/**
 * @param {string} kind
 * @param {number} timestamp
 * @param {string} sessionId
 * @param {Record<string, string>} [extra]
 */
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
      event("pageview", at(1), "s1"),
      event("pageview", at(3, 10), "s2"),
      event("pageview", at(5), "s2"),
      event("pageview", since - HOUR, "s3"),
      event("pageview", at(5, 1), "s3"),
      event("custom", at(2), "s1", { name: "signup" }),
      event("click", at(2), "s1"),
      event("pageview", at(2), "s9", { websiteId: "other-site" }),
      event("pageview", at(24), "s4"),
    ]);
    /** @param {Parameters<typeof hourlyValues>[3]} metric */
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

  test("a busy day keeps its last hours", async () => {
    const { since, at } = today();
    const busy = 1_000;
    const batch = [];
    for (let index = 0; index < busy; index++) {
      batch.push(event("pageview", at(0, index % 60), `b${index % 500}`));
    }
    await events.insertMany(batch, { ordered: false });
    await events.insertMany([
      event("pageview", at(5), "late"),
      event("pageview", at(5, 30), "late"),
    ]);
    const reads = [];
    const providerClient = await internal.client;
    const record = (started) => {
      if (started.command.aggregate === events.collectionName) {
        reads.push(started.command.pipeline);
      }
    };
    providerClient.on("commandStarted", record);
    try {
      const pageviews = await hourlyValues(WEBSITE, since, 24, "pageviews");
      assert.equal(pageviews[0], busy);
      assert.equal(pageviews[5], 2);
      const sessions = await hourlyValues(WEBSITE, since, 24, "sessions");
      assert.equal(sessions[0], 500);
      assert.equal(sessions[5], 1);
    } finally {
      providerClient.off("commandStarted", record);
    }
    assert.equal(reads.length, 2);
    for (const pipeline of reads) {
      assert.ok(pipeline.some((stage) => "$group" in stage));
      assert.ok(!pipeline.some((stage) => "$limit" in stage));
    }
  });
});
