const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const {
  EnsureFunnel,
  EnsureWebsite,
  ImportAnalytics,
} = require("@antelopejs/interface-dms-marketing");

/** Read while the files load, before any test has mocked it. */
const realGetModel = models.GetModel;
const ORIGIN = "https://interface-test.example.com";
const MINUTE = 60_000;

/**
 * Through the interface proxy, against the running module and its
 * database: what another module's backend does to ship content.
 */
describe("the content interface", () => {
  // Other files mock GetModel and the harness never gets the original back:
  // this test puts the real one, captured at load, in front of theirs.
  beforeEach(() => mock.method(models, "GetModel", realGetModel));
  afterEach(() => mock.restoreAll());

  test("declares a website and a funnel once, and imports history once", async () => {
    const site = {
      id: "interface-test-site",
      name: "Interface test",
      domain: ORIGIN,
    };
    assert.equal((await EnsureWebsite(site)).status, "created");
    assert.equal((await EnsureWebsite(site)).status, "unchanged");

    const funnel = {
      id: "interface-test-funnel",
      websiteId: site.id,
      name: "Signup",
      steps: [
        { kind: "url", value: "/" },
        { kind: "custom", value: "signup" },
      ],
      experiment: {
        key: "interface-split",
        status: "running",
        startedAt: Date.now() - 60 * MINUTE,
        variations: [
          { key: "a", weight: 1 },
          { key: "b", weight: 1 },
        ],
      },
    };
    assert.equal((await EnsureFunnel(funnel)).status, "created");
    assert.equal((await EnsureFunnel(funnel)).status, "unchanged");

    const start = Date.now() - 30 * MINUTE;
    const batch = {
      importId: "interface-test-history",
      websiteId: site.id,
      sessions: [
        {
          visitor: "visitor-1",
          events: [
            { kind: "pageview", at: start, url: `${ORIGIN}/` },
            {
              kind: "exposure",
              at: start + 1000,
              url: `${ORIGIN}/`,
              name: "interface-split",
              data: { experiment: "interface-split", variation: "b" },
            },
            {
              kind: "custom",
              at: start + MINUTE,
              url: `${ORIGIN}/`,
              name: "signup",
            },
          ],
        },
      ],
    };
    assert.deepEqual(await ImportAnalytics(batch), {
      importId: "interface-test-history",
      status: "imported",
      sessions: 1,
      events: 3,
      dropped: 0,
    });
    assert.equal((await ImportAnalytics(batch)).status, "skipped");
    await assert.rejects(
      ImportAnalytics({
        ...batch,
        importId: "wrong-tenant",
        tenantId: "another-tenant",
      }),
      /no website.*another-tenant/,
    );
    await assert.rejects(
      EnsureFunnel({ ...funnel, tenantId: "another-tenant" }),
      /no website.*another-tenant/,
    );
    await assert.rejects(
      EnsureWebsite({ ...site, tenantId: "another-tenant" }),
      /another tenant/,
    );
    await assert.rejects(
      ImportAnalytics({ ...batch, importId: "older-window" }),
      /chronological/,
    );
    // Exercise the database-backed website claim through the public proxy.
    const next = (importId) => ({
      ...batch,
      importId,
      sessions: [
        {
          visitor: "visitor-1",
          events: [
            {
              kind: "pageview",
              at: start + 2 * MINUTE,
              url: `${ORIGIN}/pricing`,
            },
          ],
        },
      ],
    });
    const raced = await Promise.allSettled([
      ImportAnalytics(next("next-a")),
      ImportAnalytics(next("next-b")),
    ]);
    assert.equal(
      raced.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.match(
      raced.find((result) => result.status === "rejected").reason.message,
      /another import/,
    );
    assert.equal((await ImportAnalytics(next("last"))).events, 1);
  });
});
