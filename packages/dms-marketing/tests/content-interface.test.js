const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const {
  EnsureFunnel,
  EnsureWebsite,
  ImportAnalytics,
} = require("@antelopejs/interface-dms-marketing");

/**
 * Read while the files load, before any test has mocked it.
 *
 * Other files mock GetModel and the harness never gets the original back: the
 * content-interface tests put this one, captured at load, in front of theirs.
 */
const realGetModel = models.GetModel;
const ORIGIN = "https://interface-test.example.com";
const MINUTE = 60_000;

describe("the content interface tenant contract", () => {
  beforeEach(() => mock.method(models, "GetModel", realGetModel));
  afterEach(() => mock.restoreAll());

  test("requires an explicit tenant before creating rows or claiming imports", async () => {
    const {
      WebsitesModel,
      FunnelsModel,
      MarketingImportsModel,
    } = require("../dist/db");
    const site = {
      id: "tenant-required",
      tenantId: "default",
      name: "Explicit",
      domain: "tenant-required.example.com",
    };
    await EnsureWebsite(site);
    const { tenantId: _tenant, ...withoutTenant } = site;
    const inputs = [
      {},
      ...[undefined, null, "", " \t\n", " default", "default ", 123].map(
        (tenantId) => ({ tenantId }),
      ),
    ];
    const funnel = {
      id: "tenant-required",
      websiteId: site.id,
      name: "Signup",
      steps: [{ kind: "url", value: "/" }],
    };
    const batch = {
      importId: "tenant-required",
      websiteId: site.id,
      sessions: [],
    };
    const sites = realGetModel(WebsitesModel);
    const before = await sites.get(site.id);
    for (const input of inputs) {
      await assert.rejects(
        EnsureWebsite({ ...withoutTenant, name: "Must not replace", ...input }),
        /tenantId: an explicit/,
      );
      await assert.rejects(
        EnsureFunnel({ ...funnel, ...input }),
        /tenantId: an explicit/,
      );
      await assert.rejects(
        ImportAnalytics({ ...batch, ...input }),
        /tenantId: an explicit/,
      );
    }
    assert.deepEqual(await sites.get(site.id), before);
    assert.equal(
      await realGetModel(FunnelsModel, "default").get(funnel.id),
      undefined,
    );
    assert.deepEqual(
      await realGetModel(MarketingImportsModel, "default").listByWebsite(
        site.id,
      ),
      [],
    );
    assert.equal(
      (await EnsureFunnel({ ...funnel, tenantId: "default" })).status,
      "created",
    );
    assert.equal(
      (await ImportAnalytics({ ...batch, tenantId: "default" })).status,
      "imported",
    );
  });
});

describe("the content interface", () => {
  beforeEach(() => mock.method(models, "GetModel", realGetModel));
  afterEach(() => mock.restoreAll());

  test("declares a website and a funnel once, and imports history once", async () => {
    const site = {
      tenantId: "default",
      id: "interface-test-site",
      name: "Interface test",
      domain: ORIGIN,
    };
    assert.equal((await EnsureWebsite(site)).status, "created");
    assert.equal((await EnsureWebsite(site)).status, "kept");

    const funnel = {
      tenantId: "default",
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
    assert.equal((await EnsureFunnel(funnel)).status, "kept");

    const start = Date.now() - 30 * MINUTE;
    const batch = {
      tenantId: "default",
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
