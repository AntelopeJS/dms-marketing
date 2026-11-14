const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const { MarketingImportsModel } = require("../dist/db");
const { importAnalytics } = require("../dist/services/analytics-import");
const {
  HISTORY,
  store,
  useFakeModels,
  website,
} = require("./helpers/analytics-import-fakes");

/**
 * Runs a holder to its done write, where a second call with the same
 * import id, which read the import row while it was running, finds the
 * holder's claim and deletes it through `ownerFinished`. The second call then
 * claims the website and finds the import done. With `takenAgain`, a third
 * call's `ownerFinished` deletes that claim too before the second releases it.
 * @param {import("./helpers/analytics-import-fakes").TrackedSite} site
 * @param {{ takenAgain: boolean }} options
 */
async function finishBesideOwnerRead(site, { takenAgain }) {
  const batch = {
    tenantId: "default",
    importId: "history",
    websiteId: site._id,
    sessions: HISTORY,
  };
  const claimId = `${site._id}:`;
  const rowId = `${site._id}:history`;
  const imports = models.GetModel(MarketingImportsModel);
  const { get, insert, writeFenced, releaseClaim } = {
    get: imports.get.bind(imports),
    insert: imports.insert.bind(imports),
    writeFenced: imports.writeFenced.bind(imports),
    releaseClaim: imports.releaseClaim.bind(imports),
  };
  const ownerRead = Promise.withResolvers();
  const doneWritten = Promise.withResolvers();
  const ownerReleased = Promise.withResolvers();
  /** @type {string | undefined} */
  let holderToken;
  /** @type {Promise<Awaited<ReturnType<typeof importAnalytics>>> | undefined} */
  let second;
  let readOwner = false;
  mock.method(
    imports,
    "insert",
    /** @param {import("../dist/db").MarketingImport} row */ async (row) => {
      if (row._id === claimId) holderToken ??= row.claimToken;
      return insert(row);
    },
  );
  mock.method(
    imports,
    "get",
    /** @param {string} id */ async (id) => {
      if (id === claimId && !readOwner) {
        const owner = await get(id);
        readOwner = true;
        ownerRead.resolve();
        return owner;
      }
      if (id === rowId && readOwner) await doneWritten.promise;
      return get(id);
    },
  );
  mock.method(
    imports,
    "writeFenced",
    /**
     * @param {string} id
     * @param {string | undefined} fence
     * @param {string} next
     * @param {Partial<import("../dist/db").MarketingImport>} patch
     */ async (id, fence, next, patch) => {
      if (patch.status !== "done") return writeFenced(id, fence, next, patch);
      second = importAnalytics(batch);
      await ownerRead.promise;
      const applied = await writeFenced(id, fence, next, patch);
      doneWritten.resolve();
      await ownerReleased.promise;
      return applied;
    },
  );
  mock.method(
    imports,
    "releaseClaim",
    /**
     * @param {string} id
     * @param {string} token
     */ async (id, token) => {
      if (takenAgain && token !== holderToken) store().imports.delete(id);
      try {
        return await releaseClaim(id, token);
      } finally {
        ownerReleased.resolve();
      }
    },
  );

  const holder = await importAnalytics(batch);
  assert.ok(second);
  return { holder, second: await second };
}

describe("an analytics import whose done claim another call deletes", () => {
  useFakeModels();

  test("a holder whose claim goes after it records done answers imported", async () => {
    const site = website("finished-holder");

    const { holder, second } = await finishBesideOwnerRead(site, {
      takenAgain: false,
    });

    assert.deepEqual([holder.status, second.status], ["imported", "skipped"]);
    assert.equal(store().imports.get(`${site._id}:history`).status, "done");
    assert.equal(store().imports.has(`${site._id}:`), false);
  });

  test("a call that finds the import done answers skipped when its claim goes before its release", async () => {
    const site = website("finished-reader");

    const { holder, second } = await finishBesideOwnerRead(site, {
      takenAgain: true,
    });

    assert.deepEqual([holder.status, second.status], ["imported", "skipped"]);
    assert.equal(store().imports.get(`${site._id}:history`).status, "done");
    assert.equal(store().imports.has(`${site._id}:`), false);
  });
});
