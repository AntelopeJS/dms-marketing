const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const { MarketingImportsModel, WebsiteStatisticsModel } = require("../dist/db");
const { importAnalytics } = require("../dist/services/analytics-import");
const {
  NOW,
  batchFor,
  drain,
  fakeTimers,
  store,
  useFakeModels,
  website,
} = require("./helpers/analytics-import-fakes");

/** Read while the files load, before any test has mocked it. */
const realGetModel = models.GetModel;

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
    fakeTimers();
    const setInterval = globalThis.setInterval;
    mock.method(
      globalThis,
      "setInterval",
      /** @param {unknown} _renew @param {number} ms */ (_renew, ms) =>
        setInterval(() => {}, ms),
    );
    const holder = importAnalytics(batchFor(site));
    await holderCommitted.promise;
    const taker = importAnalytics(batchFor(site));
    for (let second = 0; second < 30; second += 1) {
      await drain();
      mock.timers.tick(1000);
    }
    await takerAtRowWrite.promise;

    holderResumes.resolve();
    assert.equal((await holder).status, "imported");
    assert.equal(store().imports.get(rowId).status, "done");

    takerWrites.resolve();
    assert.equal((await taker).status, "skipped");
    assert.equal(store().imports.get(rowId).status, "done");
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
});
