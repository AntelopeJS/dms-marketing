const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const {
  MarketingEventsModel,
  MarketingImportsModel,
  WebsiteStatisticsModel,
} = require("../dist/db");
const { importAnalytics } = require("../dist/services/analytics-import");
const {
  NOW,
  batchFor,
  drain,
  eventsOf,
  fakeTimers,
  interceptWrites,
  store,
  useFakeModels,
  website,
} = require("./helpers/analytics-import-fakes");

/** Read while the files load, before any test has mocked it. */
const realGetModel = models.GetModel;

/** Fakes the timers, and keeps every claim renewal from running. */
function holdRenewals() {
  fakeTimers();
  const setInterval = globalThis.setInterval;
  mock.method(
    globalThis,
    "setInterval",
    /** @param {unknown} _renew @param {number} ms */ (_renew, ms) =>
      setInterval(() => {}, ms),
  );
}

/** Lets 30 polls of the watcher pass, so a silent holder is taken over. */
async function watchTimesOut() {
  for (let second = 0; second < 30; second += 1) {
    await drain();
    mock.timers.tick(1000);
  }
}

/**
 * @param {Awaited<ReturnType<typeof realGetModel>>} imports
 * @param {boolean} applies Whether the write lands before the unknown outcome
 */
function outcomeUnknown(imports, applies) {
  const atomicMutation = imports.table.atomicMutation.bind(imports.table);
  return mock.method(
    imports.table,
    "atomicMutation",
    /** @param {Parameters<typeof atomicMutation>} args */ (...args) => ({
      async run() {
        if (applies) await atomicMutation(...args).run();
        return "unknown";
      },
    }),
  );
}

describe("an analytics import whose stalled holder finishes after the takeover", () => {
  useFakeModels();

  test("a taker that read the import running answers skipped once the stalled holder marks it done", async () => {
    const site = website("finished-late");
    const rowId = `${site._id}:history`;
    const statistics = models.GetModel(WebsiteStatisticsModel);
    const insertDay = statistics.insert.bind(statistics);
    const holderCommitted = Promise.withResolvers();
    const holderResumes = Promise.withResolvers();
    let dayInserts = 0;
    mock.method(
      statistics,
      "insert",
      /** @param {import("../dist/db").WebsiteStatistics} row */ async (
        row,
      ) => {
        await insertDay(row);
        if (++dayInserts === 2) {
          holderCommitted.resolve();
          await holderResumes.promise;
        }
      },
    );
    const imports = models.GetModel(MarketingImportsModel);
    const listByWebsite = imports.listByWebsite.bind(imports);
    const takerAtRowWrite = Promise.withResolvers();
    const takerWrites = Promise.withResolvers();
    let lists = 0;
    mock.method(
      imports,
      "listByWebsite",
      /** @param {string} websiteId */ async (websiteId) => {
        const rows = await listByWebsite(websiteId);
        if (++lists === 2) {
          takerAtRowWrite.resolve();
          await takerWrites.promise;
        }
        return rows;
      },
    );
    holdRenewals();
    const holder = importAnalytics(batchFor(site));
    await holderCommitted.promise;
    const taker = importAnalytics(batchFor(site));
    await watchTimesOut();
    await takerAtRowWrite.promise;

    holderResumes.resolve();
    assert.equal((await holder).status, "imported");
    assert.equal(store().imports.get(rowId).status, "done");

    takerWrites.resolve();
    assert.equal((await taker).status, "skipped");
    assert.equal(store().imports.get(rowId).status, "done");
  });

  test("a stalled holder whose taker set the import running answers in_progress instead of marking it done", async () => {
    const site = website("overtaken-late");
    const rowId = `${site._id}:history`;
    const imports = models.GetModel(MarketingImportsModel);
    const writeFenced = imports.writeFenced.bind(imports);
    const holderFinishing = Promise.withResolvers();
    const holderResumes = Promise.withResolvers();
    const takerResumed = Promise.withResolvers();
    const holderAnswered = Promise.withResolvers();
    let doneWrites = 0;
    mock.method(
      imports,
      "writeFenced",
      /** @param {Parameters<typeof writeFenced>} args */ async (...args) => {
        const status = args[3].status;
        if (status === "done" && ++doneWrites === 1) {
          holderFinishing.resolve();
          await holderResumes.promise;
        }
        const applied = await writeFenced(...args);
        if (status === "running") {
          takerResumed.resolve();
          await holderAnswered.promise;
        }
        return applied;
      },
    );
    holdRenewals();
    const holder = importAnalytics(batchFor(site));
    await holderFinishing.promise;
    const taker = importAnalytics(batchFor(site));
    await watchTimesOut();
    await takerResumed.promise;

    holderResumes.resolve();
    assert.equal((await holder).status, "in_progress");
    assert.equal(store().imports.get(rowId).status, "running");

    holderAnswered.resolve();
    assert.equal((await taker).status, "imported");
    assert.equal(store().imports.get(rowId).status, "done");
  });
});

describe("an analytics import resumed by a holder whose renewal saw the takeover", () => {
  useFakeModels();

  test("the holder deletes none of the taker's raw rows", async () => {
    const site = website("resumed-superseded");
    const failing = interceptWrites(() => {
      throw new Error("storage failed");
    });
    await assert.rejects(importAnalytics(batchFor(site)), /failed part-way/);
    failing.mock.restore();
    const imports = models.GetModel(MarketingImportsModel);
    const writeFenced = imports.writeFenced.bind(imports);
    const swapClaim = imports.swapClaim.bind(imports);
    const holderResumed = Promise.withResolvers();
    const holderResumes = Promise.withResolvers();
    const renewalResumes = Promise.withResolvers();
    let resumes = 0;
    mock.method(
      imports,
      "writeFenced",
      /** @param {Parameters<typeof writeFenced>} args */ async (...args) => {
        const applied = await writeFenced(...args);
        if (args[3].status === "running" && ++resumes === 1) {
          holderResumed.resolve();
          await holderResumes.promise;
        }
        return applied;
      },
    );
    let swaps = 0;
    mock.method(
      imports,
      "swapClaim",
      /** @param {Parameters<typeof swapClaim>} args */ async (...args) => {
        if (++swaps === 1) await renewalResumes.promise;
        return swapClaim(...args);
      },
    );
    const takerWriting = Promise.withResolvers();
    const takerResumes = Promise.withResolvers();
    let inserts = 0;
    mock.method(
      models.GetModel(MarketingEventsModel),
      "insertMany",
      /** @param {object[]} docs */ async (docs) => {
        store().events.push(...docs);
        if (++inserts === 2) {
          takerWriting.resolve();
          await takerResumes.promise;
        }
        return docs.length;
      },
    );
    fakeTimers();
    const holder = importAnalytics(batchFor(site));
    await holderResumed.promise;
    const taker = importAnalytics(batchFor(site));
    await watchTimesOut();
    await takerWriting.promise;

    renewalResumes.resolve();
    await drain();
    holderResumes.resolve();
    assert.equal((await holder).status, "in_progress");

    takerResumes.resolve();
    assert.equal((await taker).status, "imported");
    assert.equal(eventsOf(site).length, 10);
  });
});

describe("a fenced write to an import row", () => {
  beforeEach(() => mock.method(models, "GetModel", realGetModel));
  afterEach(() => mock.restoreAll());

  test("takes a row stored without a fence once, then only the fence it installed", async () => {
    const imports = realGetModel(MarketingImportsModel, "default");
    const id = `fenced-${NOW}-${Math.random()}:history`;
    await imports.insert({
      _id: id,
      websiteId: "fenced",
      importId: "history",
      status: "failed",
      sessions: 0,
      events: 0,
      dropped: 0,
      startedAt: new Date(NOW),
      ledgered: true,
    });

    const written = [
      await imports.writeFenced(id, undefined, "first", { status: "running" }),
      await imports.writeFenced(id, undefined, "stale", { status: "failed" }),
      await imports.writeFenced(id, "first", "second", {
        status: "done",
        finishedAt: new Date(NOW),
      }),
      await imports.writeFenced(id, "first", "late", { status: "running" }),
    ];

    assert.deepEqual(written, [true, false, true, false]);
    const row = await imports.get(id);
    assert.deepEqual([row?.status, row?.fence], ["done", "second"]);
  });

  test("reads an unknown outcome back: applied, replaced, or unconfirmed while the fence stays", async () => {
    const imports = realGetModel(MarketingImportsModel, "default");
    const id = `fenced-${NOW}-${Math.random()}:history`;
    await imports.insert({
      _id: id,
      websiteId: "fenced",
      importId: "history",
      status: "running",
      sessions: 0,
      events: 0,
      dropped: 0,
      startedAt: new Date(NOW),
      ledgered: true,
      fence: "mine",
    });

    const landing = outcomeUnknown(imports, true);
    const applied = await imports.writeFenced(id, "mine", "second", {
      status: "failed",
    });
    const replaced = await imports.writeFenced(id, "mine", "third", {
      status: "done",
    });
    landing.mock.restore();
    outcomeUnknown(imports, false);

    assert.deepEqual([applied, replaced], [true, false]);
    await assert.rejects(
      imports.writeFenced(id, "second", "fourth", { status: "done" }),
      /not confirmed/,
    );
    assert.equal((await imports.get(id))?.status, "failed");
  });
});
