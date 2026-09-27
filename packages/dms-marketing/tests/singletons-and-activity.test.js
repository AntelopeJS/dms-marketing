const assert = require("node:assert/strict");
const test = it;
const { Schema } = require("@antelopejs/interface-database/schema");
const {
  DatumStaticMetadata,
  getMetadata,
} = require("@antelopejs/interface-database-decorators/common");
const { internal } = require("@antelopejs/interface-mongodb");
const {
  DrainSchemaInitializations,
} = require("@antelopejs/mongodb/dist/schema-initialization");
const { MongoClient } = require("mongodb");
const {
  MARKETING_SETTINGS_ID,
  MarketingSettingsModel,
} = require("../dist/db/models/marketing_settings.model");
const {
  MarketingSessionsModel,
} = require("../dist/db/models/marketing_sessions.model");
const {
  MarketingSession,
  marketingSessionsTableName,
} = require("../dist/db/tables/marketing_sessions.table");
const {
  getVisitorHashSecret,
  loadSettings,
} = require("../dist/services/settings");

const ACTIVITY_SCHEMA = "activity_test";
const SESSIONS_COLLECTION = `${ACTIVITY_SCHEMA}__${marketingSessionsTableName}`;
const LAST_ACTIVITY_INDEX = "websiteId_lastSeenAt";
const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
let client;
let db;
const commands = [];

/**
 * Each settings case gets a scratch schema of its own: the fixed key is
 * unique per collection, exactly like the dms-core schema the singleton lives
 * in, which only ever has the default instance.
 */
function settingsModel(schemaId) {
  return new MarketingSettingsModel(new Schema(schemaId, {}).instance());
}

function settingsRows(schemaId) {
  return db.collection(`${schemaId}__marketing_settings`).find().toArray();
}

/** The sessions table as the module declares it, indexes included, so the
 * adapter builds them the way it does at boot. */
async function sessionsModel() {
  const indexes = Object.fromEntries(
    Object.entries(
      getMetadata(MarketingSession, DatumStaticMetadata).indexes,
    ).map(([group, fields]) => [group, { fields }]),
  );
  const schema = new Schema(ACTIVITY_SCHEMA, {
    [marketingSessionsTableName]: { fields: {}, indexes },
  });
  await DrainSchemaInitializations();
  return new MarketingSessionsModel(schema.instance(TENANT));
}

before(async () => {
  client = new MongoClient(process.env.TEST_MONGO_URL);
  await client.connect();
  db = client.db("marketing_retention");
  const providerClient = await internal.client;
  providerClient.on("commandStarted", (event) => commands.push(event.command));
});

after(async () => {
  await client?.close();
});

test("concurrent first boots store one settings row and cache its secret", async () => {
  const model = settingsModel("settings_boot");
  await Promise.all([loadSettings(model), loadSettings(model)]);
  const rows = await settingsRows("settings_boot");
  assert.equal(rows.length, 1);
  assert.equal(rows[0]._id, MARKETING_SETTINGS_ID);
  assert.equal(getVisitorHashSecret(), rows[0].visitorHashSecret);
});

test("a lost singleton insert returns the winner's row", async () => {
  const model = settingsModel("settings_race");
  const [first, second] = await Promise.all([
    model.insertSingleton({ visitorHashSecret: "first" }),
    model.insertSingleton({ visitorHashSecret: "second" }),
  ]);
  const rows = await settingsRows("settings_race");
  assert.equal(rows.length, 1);
  assert.equal(first.visitorHashSecret, rows[0].visitorHashSecret);
  assert.equal(second.visitorHashSecret, rows[0].visitorHashSecret);
});

test("a singleton stored before the fixed key is still found", async () => {
  await db
    .collection("settings_legacy__marketing_settings")
    .insertOne({ _id: "legacy", _instance: null, visitorHashSecret: "old" });
  await loadSettings(settingsModel("settings_legacy"));
  const rows = await settingsRows("settings_legacy");
  assert.deepEqual(
    rows.map((row) => row._id),
    ["legacy"],
  );
  assert.equal(getVisitorHashSecret(), "old");
});

test("last activity is one indexed top-1 read per website", async () => {
  const model = await sessionsModel();
  const sessions = db.collection(SESSIONS_COLLECTION);
  const indexes = await sessions.indexes();
  assert.deepEqual(
    indexes.find((index) => index.name === LAST_ACTIVITY_INDEX)?.key,
    { websiteId: 1, lastSeenAt: 1 },
  );
  assert.deepEqual(indexes.find((index) => index.name === "lastSeenAt")?.key, {
    lastSeenAt: 1,
  });
  await sessions.insertMany(
    [
      { _id: "a-old", websiteId: "a", lastSeenAt: new Date(1_000) },
      { _id: "a-new", websiteId: "a", lastSeenAt: new Date(3_000) },
      { _id: "b-only", websiteId: "b", lastSeenAt: new Date(2_000) },
      {
        _id: "a-foreign",
        _instance: OTHER_TENANT,
        websiteId: "a",
        lastSeenAt: new Date(9_000),
      },
    ].map((row) => ({ _instance: TENANT, ...row })),
  );

  commands.length = 0;
  const activity = await model.getLastActivityByWebsites(["a", "b", "none"]);
  assert.deepEqual(
    [...activity.entries()].sort(([a], [b]) => a.localeCompare(b)),
    [
      ["a", 3_000],
      ["b", 2_000],
    ],
  );
  const reads = commands.filter(
    (command) => command.aggregate === SESSIONS_COLLECTION,
  );
  assert.equal(reads.length, 3);
  for (const read of reads) {
    assert.equal(
      read.pipeline.some((stage) => "$group" in stage),
      false,
    );
    assert.ok(read.pipeline.some((stage) => stage.$limit === 1));
    const plan = await db.command({
      explain: {
        aggregate: SESSIONS_COLLECTION,
        pipeline: read.pipeline,
        cursor: {},
      },
      verbosity: "queryPlanner",
    });
    assert.ok(
      JSON.stringify(plan).includes(`"indexName":"${LAST_ACTIVITY_INDEX}"`),
    );
  }
  assert.deepEqual(await model.getLastActivityByWebsites([]), new Map());
});
