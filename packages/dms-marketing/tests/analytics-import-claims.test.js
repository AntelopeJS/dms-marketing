const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const { MarketingEventsModel } = require("../dist/db");
const { importAnalytics } = require("../dist/services/analytics-import");
const {
  DAY_ONE,
  HISTORY,
  at,
  dayRows,
  drain,
  fakeTimers,
  runCount,
  store,
  useFakeModels,
  website,
} = require("./helpers/analytics-import-fakes");

/**
 * @param {import("./helpers/analytics-import-fakes").TrackedSite} site
 * @param {string} [importId]
 */
function batchFor(site, importId = "history") {
  return {
    tenantId: "default",
    importId,
    websiteId: site._id,
    sessions: HISTORY,
  };
}

function eventsOf(site) {
  return store().events.filter((e) => e.websiteId === site._id);
}

/** Replaces the events' write with `write`, or restores the fake's own. */
function interceptWrites(write) {
  return mock.method(
    models.GetModel(MarketingEventsModel),
    "insertMany",
    /** @param {object[]} docs */ async (docs) => {
      await write(docs);
      store().events.push(...docs);
      return docs.length;
    },
  );
}

/**
 * What a process killed mid-replay leaves in the claim and import rows.
 * @param {import("./helpers/analytics-import-fakes").TrackedSite} site
 */
function leaveClaimBehind(site) {
  const row = {
    websiteId: site._id,
    importId: "history",
    status: "running",
    sessions: 0,
    events: 0,
    dropped: 0,
    startedAt: new Date(DAY_ONE),
    ledgered: true,
  };
  store().imports.set(`${site._id}:`, {
    ...row,
    _id: `${site._id}:`,
    claimToken: "dead-holder",
  });
  store().imports.set(`${site._id}:history`, {
    ...row,
    _id: `${site._id}:history`,
  });
  store().sessions.push({
    _id: "left-behind",
    websiteId: site._id,
    importId: "history",
    visitorId: "left-behind",
    startedAt: new Date(at(0, 10, 0)),
    lastSeenAt: new Date(at(0, 10, 0)),
  });
  store().events.push({
    websiteId: site._id,
    importId: "history",
    sessionId: "left-behind",
    day: DAY_ONE,
    timestamp: new Date(at(0, 10, 0)),
    kind: "pageview",
  });
}

describe("resuming an analytics import", () => {
  useFakeModels();

  test("a failed replay blocks later imports until a call with its id resumes it", async () => {
    const site = website("failed");
    const failing = interceptWrites(() => {
      throw new Error("storage failed");
    });
    await assert.rejects(
      () => importAnalytics(batchFor(site)),
      /failed part-way/,
    );
    await assert.rejects(
      () => importAnalytics(batchFor(site, "next")),
      /did not finish/,
    );
    assert.equal(store().events.length, 0);

    failing.mock.restore();
    assert.equal((await importAnalytics(batchFor(site))).status, "imported");
    assert.equal(store().events.length, 10);
  });

  test("a replay that stops part-way resumes to what an uninterrupted one writes", async () => {
    const whole = website("whole");
    const expected = await importAnalytics(batchFor(whole));

    const site = website("resumed");
    const lastDay = at(1, 0, 0);
    let writesOnLastDay = 0;
    const failing = interceptWrites((docs) => {
      if (docs[0].timestamp.getTime() < lastDay) return;
      writesOnLastDay += 1;
      if (writesOnLastDay > 1) throw new Error("storage failed");
    });
    await assert.rejects(
      () => importAnalytics(batchFor(site)),
      /failed part-way/,
    );
    assert.ok(writesOnLastDay > 1);
    assert.ok(eventsOf(site).length > 0);

    failing.mock.restore();
    const resumed = await importAnalytics(batchFor(site));

    assert.deepEqual(
      [resumed.status, resumed.sessions, resumed.events],
      ["imported", expected.sessions, expected.events],
    );
    assert.equal(eventsOf(site).length, expected.events);
    assert.equal(
      store().sessions.filter((s) => s.websiteId === site._id).length,
      expected.sessions,
    );
    assert.deepEqual(dayRows(site._id), dayRows(whole._id));
  });

  test("an import stopped before the ledger existed is never replayed", async () => {
    const site = website("unledgered");
    store().imports.set(`${site._id}:history`, {
      _id: `${site._id}:history`,
      websiteId: site._id,
      importId: "history",
      status: "failed",
      sessions: 0,
      events: 0,
      dropped: 0,
    });
    const result = await importAnalytics(batchFor(site));
    assert.equal(result.status, "failed");
    assert.equal(store().events.length, 0);
  });
});

describe("an analytics import's claims", () => {
  useFakeModels();

  test("a claim whose holder stopped is taken over once its token stays unchanged", async () => {
    const site = website("stopped");
    leaveClaimBehind(site);
    fakeTimers();
    let settled = false;
    const resumed = importAnalytics(batchFor(site)).finally(() => {
      settled = true;
    });
    for (let second = 0; second < 29; second += 1) {
      await drain();
      mock.timers.tick(1000);
    }
    await drain();
    assert.equal(settled, false);
    assert.equal(store().imports.get(`${site._id}:`).claimToken, "dead-holder");

    mock.timers.tick(1000);
    assert.equal((await resumed).status, "imported");
    assert.equal(eventsOf(site).length, 10);
    assert.equal(store().imports.has(`${site._id}:`), false);
  });

  test("a slow holder keeps its claim however long its replay takes", async () => {
    const site = website("slow");
    const stalled = Promise.withResolvers();
    const writing = Promise.withResolvers();
    interceptWrites(async () => {
      writing.resolve();
      await stalled.promise;
    });
    fakeTimers();
    const holder = importAnalytics(batchFor(site));
    await writing.promise;
    for (let second = 0; second < 300; second += 1) {
      mock.timers.tick(1000);
      await drain();
    }

    const second = importAnalytics(batchFor(site));
    for (let tick = 0; tick < 6; tick += 1) {
      await drain();
      mock.timers.tick(1000);
    }
    assert.equal((await second).status, "in_progress");

    stalled.resolve();
    assert.equal((await holder).status, "imported");
    assert.equal(eventsOf(site).length, 10);
  });

  test("legacy claims without a chronology boundary require reconciliation", async () => {
    const site = website("legacy");
    store().imports.set(`${site._id}:old`, {
      _id: `${site._id}:old`,
      websiteId: site._id,
      importId: "old",
      status: "done",
      events: 1,
    });
    await assert.rejects(
      () => importAnalytics(batchFor(site, "new")),
      /reconciliation/,
    );
    assert.equal(store().events.length, 0);
    assert.equal(store().imports.has(`${site._id}:new`), false);
  });

  test("different import ids cannot replay the same website concurrently", async () => {
    const site = website("exclusive");
    const results = await Promise.allSettled([
      importAnalytics(batchFor(site, "a")),
      importAnalytics(batchFor(site, "b")),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const refusals = results.flatMap((r) =>
      r.status === "rejected" && r.reason instanceof Error
        ? [r.reason.message]
        : [],
    );
    assert.equal(refusals.length, 1);
    assert.match(refusals[0], /another import/);
    assert.equal(store().events.length, 10);
  });

  test("an import id is applied once; a racing call writes nothing", async () => {
    const site = website("once");
    const batch = {
      ...batchFor(site, "seed"),
      sessions: [{ ...HISTORY[1], visitor: `b-${runCount()}` }],
    };
    const [first, second] = await Promise.all([
      importAnalytics(batch),
      importAnalytics(batch),
    ]);
    const statuses = [first, second].map((r) => `${r.status}:${r.events}`);
    assert.deepEqual(
      statuses.sort((x, y) => x.localeCompare(y)),
      ["imported:3", "skipped:3"],
    );
    const again = await importAnalytics({ ...batch, sessions: HISTORY });
    assert.deepEqual([again.status, again.events], ["skipped", 3]);
    assert.equal(eventsOf(site).length, 3);
    assert.equal(store().imports.get(`${site._id}:seed`).status, "done");
  });
});
