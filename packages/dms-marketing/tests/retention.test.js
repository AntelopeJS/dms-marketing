const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const { Schema } = require("@antelopejs/interface-database/schema");
const databaseQuery = require("@antelopejs/interface-database/query");
const models = require("@antelopejs/interface-database-decorators/model");
const { internal } = require("@antelopejs/interface-mongodb");
const { MongoClient } = require("mongodb");
const { GetAtomicCollection } = require("@antelopejs/mongodb/dist/connection");
const {
  MarketingEventsModel,
} = require("../dist/db/models/marketing_events.model");
const {
  MarketingSessionsModel,
} = require("../dist/db/models/marketing_sessions.model");
const {
  PageSnapshotsModel,
} = require("../dist/db/models/page_snapshots.model");
const {
  WebsiteStatisticsModel,
} = require("../dist/db/models/website_statistics.model");
const { setConfig } = require("../dist/config");
const {
  pruneRawEvents,
  pruneSessions,
  pruneSnapshots,
  pruneStatistics,
  pruneStatisticsTops,
  pruneAllTenants,
} = require("../dist/services/prune");

const SCHEMA = "retention_test";
const TENANT = "tenant-a";
const OTHER_TENANT = "tenant-b";
const NOW = Date.UTC(2026, 8, 14);
const DAY = 86_400_000;
const CUTOFF = new Date(NOW - 5 * DAY);
let client;
let db;
let beforeWrite;
const commands = [];

function modelFor(Model) {
  return new Model(new Schema(SCHEMA, {}).instance(TENANT));
}

function collectionFor(table) {
  return db.collection(`${SCHEMA}__${table}`);
}

before(async () => {
  client = new MongoClient(process.env.TEST_MONGO_URL);
  await client.connect();
  db = client.db("marketing_retention");
  const providerClient = await internal.client;
  providerClient.on("commandStarted", (event) => commands.push(event.command));
  // Atomic commands use a separate client; observe it without bypassing interface execution.
  GetAtomicCollection(SCHEMA).client.on("commandStarted", (event) =>
    commands.push(event.command),
  );
});

beforeEach(() => {
  const runQuery = databaseQuery.RunQuery;
  mock.method(databaseQuery, "RunQuery", async (stages) => {
    if (stages.at(-1).stage === "atomicMutation") {
      const hook = beforeWrite;
      beforeWrite = undefined;
      await hook?.();
    }
    return runQuery(stages);
  });
});

afterEach(() => {
  mock.restoreAll();
  beforeWrite = undefined;
});

after(async () => {
  await client?.close();
});

const DELETIONS = [
  [MarketingEventsModel, "marketing_events", "timestamp"],
  [MarketingSessionsModel, "marketing_sessions", "lastSeenAt"],
  [PageSnapshotsModel, "marketing_page_snapshots", "capturedAt"],
];

for (const [Model, table, field] of DELETIONS) {
  test(`${table}: concurrent retention preserves boundaries and other tenants`, async () => {
    const collection = collectionFor(table);
    await collection.insertMany([
      { _id: "expired", _instance: TENANT, [field]: new Date(+CUTOFF - 1) },
      { _id: "boundary", _instance: TENANT, [field]: CUTOFF },
      { _id: "active", _instance: TENANT, [field]: new Date(+CUTOFF + 1) },
      { _id: "other", _instance: OTHER_TENANT, [field]: new Date(1) },
      { _id: "before-epoch", _instance: TENANT, [field]: new Date(-1) },
    ]);
    const model = modelFor(Model);
    const counts = await Promise.all([
      model.deleteOlderThan(CUTOFF),
      model.deleteOlderThan(CUTOFF),
    ]);
    assert.equal(
      counts.reduce((sum, count) => sum + count, 0),
      1,
    );
    assert.equal(await model.deleteOlderThan(CUTOFF), 0);
    const rows = await collection.find().sort({ _id: 1 }).toArray();
    assert.deepEqual(
      rows.map((row) => row._id),
      ["active", "before-epoch", "boundary", "other"],
    );
  });
}

for (const [Model, table, field] of DELETIONS.slice(1)) {
  test(`${table}: a refresh after candidate selection survives atomic deletion`, async () => {
    const collection = collectionFor(table);
    await collection.insertOne({
      _id: "refreshed",
      _instance: TENANT,
      [field]: new Date(1),
      pageviewsCount: 2,
      eventsCount: 3,
    });
    const model = modelFor(Model);
    beforeWrite = async () => {
      const activeAt = new Date(NOW);
      if (field === "lastSeenAt") {
        await model.recordActivity("refreshed", {
          lastSeenAt: activeAt,
          pageviews: 1,
          events: 2,
        });
      } else {
        await model.upsert({
          _id: "refreshed",
          capturedAt: activeAt,
          html: "new capture",
        });
      }
      commands.length = 0;
    };
    assert.equal(await model.deleteOlderThan(CUTOFF), 0);
    const writes = commands.filter((command) => command.delete);
    assert.equal(writes.length, 1);
    assert.equal(
      commands.some((command) => command.find || command.aggregate),
      false,
    );
    assert.equal(writes[0].deletes[0].q._id, "refreshed");
    assert.equal(writes[0].deletes[0].q._instance, TENANT);
    assert.deepEqual(writes[0].deletes[0].q.$expr, {
      $eq: [`$${field}`, { $literal: new Date(1) }],
    });
    assert.equal(writes[0].deletes[0].limit, 1);
    const row = await collection.findOne({ _id: "refreshed" });
    assert.equal(+row[field], NOW);
    assert.equal(row._instance, TENANT);
    assert.equal(
      row.pageviewsCount ?? row.html,
      field === "lastSeenAt" ? 3 : "new capture",
    );
  });
}

for (const outcome of ["unknown", "not-applied"]) {
  test(`conditional cleanup handles ${outcome} without retry or false success`, async () => {
    const model = modelFor(MarketingSessionsModel);
    const attempts = [];
    mock.method(databaseQuery, "RunQuery", async (stages) => {
      const stage = stages.at(-1);
      if (stage.stage !== "atomicMutation") {
        const candidates = [{ _id: "expired", lastSeenAt: new Date(1) }];
        if (outcome === "unknown") {
          candidates.push({ _id: "later", lastSeenAt: new Date(2) });
        }
        return candidates;
      }
      attempts.push(stage.args);
      return outcome;
    });
    const result = model.deleteOlderThan(CUTOFF);
    if (outcome === "unknown") {
      await assert.rejects(result, /Retention deletion outcome is unknown/);
    } else {
      assert.equal(await result, 0);
    }
    assert.deepEqual(attempts, [
      [
        "expired",
        {
          type: "deleteIfEqual",
          field: "lastSeenAt",
          expectedValue: new Date(1),
        },
      ],
    ]);
  });
}

test("unsupported atomic deletion fails without a generic-write fallback", async () => {
  const stagesSeen = [];
  const unsupported = new Error("atomic mutation unsupported");
  mock.method(databaseQuery, "RunQuery", async (stages) => {
    const name = stages.at(-1).stage;
    stagesSeen.push(name);
    if (name === "pluck") {
      return [{ _id: "expired", capturedAt: new Date(1) }];
    }
    throw unsupported;
  });
  await assert.rejects(
    modelFor(PageSnapshotsModel).deleteOlderThan(CUTOFF),
    unsupported,
  );
  assert.deepEqual(stagesSeen, ["pluck", "atomicMutation"]);
});

test("rollup replay empties only expired maps, preserves scalars and tenant boundaries", async () => {
  const collection = collectionFor("marketing_website_statistics");
  const rows = [
    { _id: "expired", _instance: TENANT, day: +CUTOFF - 1 },
    { _id: "boundary", _instance: TENANT, day: +CUTOFF },
    { _id: "other", _instance: OTHER_TENANT, day: 1 },
  ].map((row) => ({
    ...row,
    pageviews: 17,
    sessions: 3,
    tops: { pages: { "/": 7 } },
  }));
  await collection.insertMany(rows);
  const model = modelFor(WebsiteStatisticsModel);
  await Promise.all([
    model.emptyTopsBefore(+CUTOFF),
    model.emptyTopsBefore(+CUTOFF),
  ]);
  assert.equal(await model.emptyTopsBefore(+CUTOFF), 0);
  const expired = await collection.findOne({ _id: "expired" });
  assert.equal(expired.pageviews, 17);
  assert.equal(expired.sessions, 3);
  assert.ok(
    Object.values(expired.tops).every((map) => Object.keys(map).length === 0),
  );
  for (const row of rows.slice(1)) {
    assert.deepEqual(await collection.findOne({ _id: row._id }), row);
  }
  const counts = await Promise.all([
    model.deleteDaysBefore(+CUTOFF),
    model.deleteDaysBefore(+CUTOFF),
  ]);
  assert.equal(
    counts.reduce((sum, count) => sum + count, 0),
    1,
  );
  assert.equal(await model.deleteDaysBefore(+CUTOFF), 0);
  assert.deepEqual(
    (await collection.find().sort({ _id: 1 }).toArray()).map((row) => row._id),
    ["boundary", "other"],
  );
});

test("retention services keep their separate windows and snapshot minimum", async () => {
  mock.method(Date, "now", () => NOW);
  setConfig({
    rawEventsRetention: 5 * DAY,
    snapshotRetention: 7 * DAY,
    statisticsRetention: 180 * DAY,
  });
  const cutoffs = [];
  const model = {
    async deleteOlderThan(cutoff) {
      cutoffs.push(+cutoff);
      return 0;
    },
    async deleteDaysBefore(cutoff) {
      cutoffs.push(cutoff);
      return 0;
    },
    async emptyTopsBefore(cutoff) {
      cutoffs.push(cutoff);
      return 0;
    },
  };
  await pruneRawEvents(model);
  await pruneSnapshots(model);
  await pruneSessions(model);
  await pruneStatistics(model);
  await pruneStatisticsTops(model);
  setConfig({ rawEventsRetention: 5 * DAY, snapshotRetention: 2 * DAY });
  await pruneSnapshots(model);
  assert.deepEqual(cutoffs, [
    NOW - 5 * DAY,
    NOW - 5 * DAY,
    NOW - 180 * DAY,
    NOW - 180 * DAY,
    NOW - 90 * DAY,
    NOW - 2 * DAY,
  ]);
  setConfig();
});

test("a failed cleanup does not skip other retention effects or tenants", async () => {
  const calls = [];
  const failure = new Error("event retention failed");
  mock.method(models, "GetModel", (Model, tenantId) => {
    if (!tenantId) {
      return { listTenantIds: async () => [TENANT, OTHER_TENANT] };
    }
    const prune = async () => {
      calls.push([tenantId, Model.name]);
      if (tenantId === TENANT && Model === MarketingEventsModel) {
        throw failure;
      }
      return 0;
    };
    return {
      deleteOlderThan: prune,
      deleteDaysBefore: prune,
      emptyTopsBefore: prune,
    };
  });
  const errors = [];
  await pruneAllTenants((error) => errors.push(error));
  assert.deepEqual(errors, [failure]);
  assert.deepEqual(
    calls,
    [TENANT, OTHER_TENANT].flatMap((tenantId) =>
      [
        "MarketingEventsModel",
        "PageSnapshotsModel",
        "MarketingSessionsModel",
        "WebsiteStatisticsModel",
        "WebsiteStatisticsModel",
      ].map((name) => [tenantId, name]),
    ),
  );
});
