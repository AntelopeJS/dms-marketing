const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const {
  EnsurePageSnapshot,
  EnsureWebsite,
} = require("@antelopejs/interface-dms-marketing");
const { PageSnapshotsModel } = require("../dist/db");
const { readPageSnapshot } = require("../dist/services/snapshots");

/** Read while the files load, before any test has mocked it. */
const realGetModel = models.GetModel;
const HOST = "snapshot-test.example.com";

function page(html, extra = {}) {
  return {
    tenantId: "default",
    websiteId: "declared-snapshots",
    url: `https://${HOST}/pricing?utm_source=x`,
    html,
    viewport: { width: 1280, height: 800 },
    document: { width: 1280, height: 2400 },
    ...extra,
  };
}

/** Declared again by every test: the declarations are idempotent. */
async function ensureWebsites() {
  await EnsureWebsite({
    id: "declared-snapshots",
    tenantId: "default",
    name: "Snapshots",
    domain: HOST,
    snapshotsEnabled: true,
  });
  await EnsureWebsite({
    id: "declared-snapshots-off",
    tenantId: "default",
    name: "Snapshots off",
    domain: "snapshots-off.example.com",
  });
}

describe("a page snapshot declared from code", () => {
  beforeEach(async () => {
    mock.method(models, "GetModel", realGetModel);
    await ensureWebsites();
  });
  afterEach(() => mock.restoreAll());

  test("is stored like a capture, once", async () => {
    const first = page("<html><body><h1>Plans</h1><script>x()</script>");
    assert.deepEqual(await EnsurePageSnapshot(first), {
      url: "/pricing",
      layout: "desktop",
      status: "created",
    });
    assert.equal((await EnsurePageSnapshot(first)).status, "kept");
    const stored = await readPageSnapshot(
      "default",
      "declared-snapshots",
      "/pricing",
      "desktop",
    );
    assert.equal(stored.origin, `https://${HOST}`);
    assert.equal(stored.url, `https://${HOST}/pricing`);
    assert.deepEqual(stored.document, { width: 1280, height: 2400 });
    assert.match(stored.html, /<h1>Plans<\/h1>/);
    assert.doesNotMatch(stored.html, /<script/);

    const second = page("<html><body><h1>New plans</h1>");
    assert.equal((await EnsurePageSnapshot(second)).status, "kept");
    assert.match(
      (
        await readPageSnapshot(
          "default",
          "declared-snapshots",
          "/pricing",
          "desktop",
        )
      ).html,
      /<h1>Plans<\/h1>/,
    );
    const phone = page("<html><body>Phone", {
      viewport: { width: 390, height: 844 },
    });
    assert.equal((await EnsurePageSnapshot(phone)).layout, "phone");
  });

  test("never replaces a capture of the live page", async () => {
    const declared = page("<html><body>Declared", { url: `https://${HOST}/` });
    assert.equal((await EnsurePageSnapshot(declared)).status, "created");
    const model = realGetModel(PageSnapshotsModel, "default");
    const [row] = await model.getByPath("declared-snapshots", "/");
    await model.upsert(Object.assign(row, { capturedAt: new Date() }));
    const again = page("<html><body>Declared again", {
      url: `https://${HOST}/`,
    });
    assert.equal((await EnsurePageSnapshot(again)).status, "kept");
    assert.equal((await model.getByPath("declared-snapshots", "/")).length, 1);
  });

  test("is refused on bad input, an unknown website or snapshots off", async () => {
    await assert.rejects(
      EnsurePageSnapshot(page("<p>x</p>", { websiteId: "nowhere" })),
      /no website "nowhere"/,
    );
    await assert.rejects(
      EnsurePageSnapshot(
        page("<p>x</p>", {
          websiteId: "declared-snapshots-off",
          url: "https://snapshots-off.example.com/",
        }),
      ),
      /snapshots are off/,
    );
    await assert.rejects(
      EnsurePageSnapshot(page("<p>x</p>", { url: "https://elsewhere.test/" })),
      /host the website/,
    );
    await assert.rejects(
      EnsurePageSnapshot(page("<p>x</p>", { viewport: { width: 0 } })),
      /viewport/,
    );
    await assert.rejects(
      EnsurePageSnapshot(page("<p>x</p>", { tenantId: " default" })),
      /tenantId/,
    );
  });
});
