const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const { MarketingImportsModel } = require("../dist/db");
const { importAnalytics } = require("../dist/services/analytics-import");
const {
  batchFor,
  drain,
  eventsOf,
  fakeTimers,
  interceptWrites,
  store,
  useFakeModels,
  website,
} = require("./helpers/analytics-import-fakes");

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

describe("an analytics import whose renewal saw the takeover", () => {
  useFakeModels();

  test("a holder whose renewal saw the takeover answers in_progress and leaves the taker's import running", async () => {
    const site = website("superseded");
    const imports = models.GetModel(MarketingImportsModel);
    const insert = imports.insert.bind(imports);
    const swapClaim = imports.swapClaim.bind(imports);
    const holderInserted = Promise.withResolvers();
    const holderResumes = Promise.withResolvers();
    const renewalResumes = Promise.withResolvers();
    let rowInserts = 0;
    mock.method(
      imports,
      "insert",
      /** @param {import("../dist/db").MarketingImport} row */ async (row) => {
        const inserted = await insert(row);
        if (row._id === `${site._id}:history` && ++rowInserts === 1) {
          holderInserted.resolve();
          await holderResumes.promise;
        }
        return inserted;
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
        if (++swaps === 1) await renewalResumes.promise;
        return swapClaim(id, token);
      },
    );
    const takerWriting = Promise.withResolvers();
    const takerResumes = Promise.withResolvers();
    interceptWrites(async () => {
      takerWriting.resolve();
      await takerResumes.promise;
    });
    fakeTimers();
    const holder = importAnalytics(batchFor(site));
    await holderInserted.promise;
    const taker = importAnalytics(batchFor(site));
    for (let second = 0; second < 30; second += 1) {
      await drain();
      mock.timers.tick(1000);
    }
    await takerWriting.promise;

    renewalResumes.resolve();
    await drain();
    holderResumes.resolve();
    assert.equal((await holder).status, "in_progress");
    assert.equal(store().imports.get(`${site._id}:history`).status, "running");

    takerResumes.resolve();
    assert.equal((await taker).status, "imported");
    assert.equal(eventsOf(site).length, 10);
  });
});
