const assert = require("node:assert/strict");
const { mock } = require("node:test");
const { DuplicateKeyError } = require("@antelopejs/interface-database");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const { MarketingEventsModel, MarketingImportsModel } = require("../dist/db");
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

describe("an analytics import whose claim was taken over", () => {
  useFakeModels();

  test("a stalled holder that loses its import row to the taker answers in_progress and writes nothing", async () => {
    const site = website("overtaken");
    const imports = models.GetModel(MarketingImportsModel);
    const insert = imports.insert.bind(imports);
    const swapClaim = imports.swapClaim.bind(imports);
    const holderInserting = Promise.withResolvers();
    const holderResumes = Promise.withResolvers();
    let rowInserts = 0;
    mock.method(
      imports,
      "insert",
      /** @param {import("../dist/db").MarketingImport} row */ async (row) => {
        if (row._id === `${site._id}:history` && ++rowInserts === 1) {
          holderInserting.resolve();
          await holderResumes.promise;
        }
        return insert(row);
      },
    );
    let swaps = 0;
    mock.method(
      imports,
      "swapClaim",
      /**
       * @param {string} id
       * @param {string} token
       */
      async (id, token) => {
        if (++swaps === 1) await holderResumes.promise;
        return swapClaim(id, token);
      },
    );
    const failing = interceptWrites(() => {
      throw new Error("storage failed");
    });
    fakeTimers();
    const holder = importAnalytics(batchFor(site));
    await holderInserting.promise;
    const taker = importAnalytics(batchFor(site));
    for (let second = 0; second < 30; second += 1) {
      await drain();
      mock.timers.tick(1000);
    }
    await assert.rejects(taker, /failed part-way/);

    holderResumes.resolve();
    assert.equal((await holder).status, "in_progress");
    assert.equal(eventsOf(site).length, 0);

    failing.mock.restore();
    assert.equal((await importAnalytics(batchFor(site))).status, "imported");
    assert.equal(eventsOf(site).length, 10);
  });

  test("a stalled holder that never renewed answers in_progress and leaves the taker's claim", async () => {
    const site = website("unrenewed");
    const imports = models.GetModel(MarketingImportsModel);
    const insert = imports.insert.bind(imports);
    const holderInserting = Promise.withResolvers();
    const holderResumes = Promise.withResolvers();
    let rowInserts = 0;
    mock.method(
      imports,
      "insert",
      /** @param {import("../dist/db").MarketingImport} row */ async (row) => {
        if (row._id === `${site._id}:history` && ++rowInserts === 1) {
          holderInserting.resolve();
          await holderResumes.promise;
        }
        return insert(row);
      },
    );
    const takerWriting = Promise.withResolvers();
    const takerResumes = Promise.withResolvers();
    interceptWrites(async () => {
      takerWriting.resolve();
      await takerResumes.promise;
    });
    fakeTimers();
    const setInterval = globalThis.setInterval;
    mock.method(
      globalThis,
      "setInterval",
      /** @param {unknown} _renew @param {number} ms */ (_renew, ms) =>
        setInterval(() => {}, ms),
    );
    const holder = importAnalytics(batchFor(site));
    await holderInserting.promise;
    const taker = importAnalytics(batchFor(site));
    for (let second = 0; second < 30; second += 1) {
      await drain();
      mock.timers.tick(1000);
    }
    await takerWriting.promise;
    const takerClaim = store().imports.get(`${site._id}:`).claimToken;

    holderResumes.resolve();
    assert.equal((await holder).status, "in_progress");
    assert.equal(store().imports.get(`${site._id}:`).claimToken, takerClaim);

    takerResumes.resolve();
    assert.equal((await taker).status, "imported");
    assert.equal(eventsOf(site).length, 10);
  });
});

describe("an analytics import whose row insert fails", () => {
  useFakeModels();

  /**
   * Makes the insert of the site's import row run `onInsert` first, as another
   * instance writing in between would.
   * @param {import("./helpers/analytics-import-fakes").TrackedSite} site
   * @param {() => void} onInsert
   */
  function interceptRowInsert(site, onInsert) {
    const imports = models.GetModel(MarketingImportsModel);
    const insert = imports.insert.bind(imports);
    return mock.method(
      imports,
      "insert",
      /** @param {import("../dist/db").MarketingImport} row */ async (row) => {
        if (row._id === `${site._id}:history`) onInsert();
        return insert(row);
      },
    );
  }

  /**
   * Makes the site's import row appear just before this call inserts it.
   * @param {import("./helpers/analytics-import-fakes").TrackedSite} site
   */
  function interceptDuplicateRow(site) {
    interceptRowInsert(site, () => {
      store().imports.set(`${site._id}:history`, {
        _id: `${site._id}:history`,
        websiteId: site._id,
        importId: "history",
        status: "running",
        sessions: 0,
        events: 0,
        dropped: 0,
        startedAt: new Date(DAY_ONE),
        ledgered: true,
      });
    });
  }

  test("a duplicate row found while this call holds the claim releases the claim", async () => {
    const site = website("duplicate");
    interceptDuplicateRow(site);

    const result = await importAnalytics(batchFor(site));

    assert.equal(result.status, "in_progress");
    assert.equal(eventsOf(site).length, 0);
    assert.equal(store().imports.has(`${site._id}:`), false);
    assert.equal((await importAnalytics(batchFor(site))).status, "imported");
    assert.equal(eventsOf(site).length, 10);
  });

  test("a duplicate row's claim release that fails once in storage is retried", async () => {
    const site = website("release-retried");
    interceptDuplicateRow(site);
    const imports = models.GetModel(MarketingImportsModel);
    const releaseClaim = imports.releaseClaim.bind(imports);
    let releases = 0;
    mock.method(
      imports,
      "releaseClaim",
      /**
       * @param {string} id
       * @param {string} token
       */
      async (id, token) => {
        if (++releases === 1) throw new Error("socket closed");
        return releaseClaim(id, token);
      },
    );

    const result = await importAnalytics(batchFor(site));

    assert.equal(result.status, "in_progress");
    assert.equal(store().imports.has(`${site._id}:`), false);
  });

  test("a failed insert that leaves no row rethrows its error and releases the claim", async () => {
    const site = website("unreachable");
    const failing = interceptRowInsert(site, () => {
      throw new Error("socket closed");
    });

    await assert.rejects(() => importAnalytics(batchFor(site)), {
      message: "socket closed",
    });

    assert.equal(store().imports.has(`${site._id}:`), false);
    assert.equal(store().imports.has(`${site._id}:history`), false);
    assert.equal(eventsOf(site).length, 0);

    failing.mock.restore();
    assert.equal((await importAnalytics(batchFor(site))).status, "imported");
    assert.equal(eventsOf(site).length, 10);
  });
});

describe("an analytics import whose claim insert fails", () => {
  useFakeModels();

  /**
   * Makes the site's claim row insert run `onInsert` first.
   * @param {import("./helpers/analytics-import-fakes").TrackedSite} site
   * @param {() => void} onInsert
   */
  function interceptClaimInsert(site, onInsert) {
    const imports = models.GetModel(MarketingImportsModel);
    const insert = imports.insert.bind(imports);
    return mock.method(
      imports,
      "insert",
      /** @param {import("../dist/db").MarketingImport} row */ async (row) => {
        if (row._id === `${site._id}:`) onInsert();
        return insert(row);
      },
    );
  }

  test("a claim insert that loses to a holder released before the owner read inserts again", async () => {
    const site = website("released-holder");
    const imports = models.GetModel(MarketingImportsModel);
    const get = imports.get.bind(imports);
    let holderPresent = false;
    interceptClaimInsert(site, () => {
      if (holderPresent) return;
      holderPresent = true;
      store().imports.set(`${site._id}:`, {
        _id: `${site._id}:`,
        websiteId: site._id,
        importId: "history",
        claimToken: "holder",
      });
    });
    mock.method(
      imports,
      "get",
      /** @param {string} id */ async (id) => {
        if (id === `${site._id}:`) store().imports.delete(id);
        return get(id);
      },
    );

    const result = await importAnalytics(batchFor(site));

    assert.equal(result.status, "imported");
    assert.equal(eventsOf(site).length, 10);
    assert.equal(store().imports.has(`${site._id}:`), false);
  });

  test("a claim row the owner read cannot see refuses the import after a bounded retry", async () => {
    const site = website("unseen-claim");
    let claimInserts = 0;
    interceptClaimInsert(site, () => {
      claimInserts += 1;
      throw new DuplicateKeyError("_id", ["_id"]);
    });

    await assert.rejects(
      () => importAnalytics(batchFor(site)),
      /is claimed by an import outside the tenant "default"/,
    );

    assert.equal(claimInserts, 3);
    assert.equal(eventsOf(site).length, 0);
  });

  test("a claim insert that fails in storage and leaves no row rethrows its error", async () => {
    const site = website("claim-unreachable");
    interceptClaimInsert(site, () => {
      throw new Error("socket closed");
    });

    await assert.rejects(() => importAnalytics(batchFor(site)), {
      message: "socket closed",
    });

    assert.equal(store().imports.has(`${site._id}:`), false);
    assert.equal(eventsOf(site).length, 0);
  });
});
