const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const { EnsureWebsite } = require("@antelopejs/interface-dms-marketing");
const { generateAccessToken } = require("@antelopejs/interface-dms/auth");
const { UserModel } = require("@antelopejs/interface-dms/auth/db");
const {
  resolveRequestTenantId,
} = require("@antelopejs/interface-dms/request-tenant");
const { WebsitesModel } = require("../dist/db");
const { withCardRow, withCardRows } = require("../dist/data-api/websites");
const { MarketingWebsitesPage } = require("../dist/pages/websites/page");
const { mergeWebsiteCards } = require("../dist/services/website-report");
const { WEBSITES_REALTIME_TOPIC } = require("../dist/types/constants");

/** Read while the files load, before any test has mocked it. */
const realGetModel = models.GetModel;

/** A request of the default tenant, as the JWT fallback reads it. */
const DEFAULT_TENANT_CTX = { rawRequest: { headers: {} } };

/**
 * A request of a user of `tenantId`, its token verified and its tenant bound
 * as the route's auth decorator does at runtime: dms 0.10 never reads the
 * tenant of an unverified token.
 */
async function requestOf(tenantId) {
  const users = realGetModel(UserModel);
  const [userId] = await users.insert({
    email: `${tenantId}@example.com`,
    name: tenantId,
    authKey: `${tenantId}-auth-key`,
    isValidated: true,
  });
  const user = await users.get(userId);
  const { token } = await generateAccessToken(tenantId, user);
  const ctx = { rawRequest: { headers: { authorization: `Bearer ${token}` } } };
  assert.equal(await resolveRequestTenantId(ctx), tenantId);
  return ctx;
}

/** A list route answering `rows`, as the data controller's would. */
const listing = (rows) => ({
  func: async () => ({ results: rows, total: rows.length, offset: 0 }),
});

function tableOptions() {
  return MarketingWebsitesPage.websites.serializeSync().options;
}

describe("the Websites table", () => {
  beforeEach(() => mock.method(models, "GetModel", realGetModel));
  afterEach(() => mock.restoreAll());

  test("each listed row takes its card, in the list's order", () => {
    const rows = [
      { _id: "b", name: "B" },
      { _id: "a", name: "A" },
      { _id: "c" },
    ];
    const cards = [
      { id: "a", state: "live", sessions: 3 },
      { id: "b", state: "waiting", sessions: 0 },
    ];
    assert.deepEqual(mergeWebsiteCards(rows, cards), [
      { _id: "b", name: "B", id: "b", state: "waiting", sessions: 0 },
      { _id: "a", name: "A", id: "a", state: "live", sessions: 3 },
      // Gone between the two reads: listed as it came.
      { _id: "c" },
    ]);
  });

  test("the list answers the tenant's rows with their cards, never another tenant's", async () => {
    await EnsureWebsite({
      id: "table-cards-a",
      tenantId: "default",
      name: "Cards A",
      domain: "cards-a.example.com",
    });
    await realGetModel(WebsitesModel).insert({
      _id: "table-cards-foreign",
      tenantId: "table-cards-other",
      name: "Foreign",
      domain: "foreign.example.com",
      extraDomains: [],
      trackingEnabled: true,
      snapshotsEnabled: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const route = withCardRows(
      listing([{ _id: "table-cards-a" }, { _id: "table-cards-foreign" }]),
    );
    const answer = await route.func(DEFAULT_TENANT_CTX, {});
    assert.equal(answer.total, 2);
    const [own, foreign] = answer.results;
    assert.equal(own.state, "waiting");
    assert.equal(own.domain, "cards-a.example.com");
    assert.deepEqual(own.extraDomains, []);
    assert.equal(own.sessions, 0);
    assert.equal(own.snapshots, 0);
    assert.deepEqual(own.rejected, []);
    // Another tenant's id, whatever brought it here, gets no card.
    assert.deepEqual(foreign, { _id: "table-cards-foreign" });

    const asOther = await withCardRows(
      listing([{ _id: "table-cards-a" }]),
    ).func(await requestOf("table-cards-other"), {});
    assert.deepEqual(asOther.results, [{ _id: "table-cards-a" }]);
  });

  test("an empty page reads nothing more", async () => {
    const answer = await withCardRows(listing([])).func(DEFAULT_TENANT_CTX, {});
    assert.deepEqual(answer.results, []);
  });

  test("a row read by id (a deep link) carries its card too", async () => {
    await EnsureWebsite({
      id: "table-cards-get",
      tenantId: "default",
      name: "Cards get",
      domain: "cards-get.example.com",
    });
    const route = withCardRow({
      func: async () => ({ _id: "table-cards-get", name: "Cards get" }),
    });
    const row = await route.func(DEFAULT_TENANT_CTX, { id: "table-cards-get" });
    assert.equal(row.id, "table-cards-get");
    assert.equal(row.state, "waiting");
    assert.equal(typeof row.createdAt, "number");
  });

  test("the Websites page lists the sites as cards drawn by the module", () => {
    const options = tableOptions();
    assert.deepEqual(
      options.displays.map((display) => display.id),
      ["cards", "table"],
    );
    assert.equal(options.defaultDisplay, "cards");
    const cards = options.displays.find((display) => display.id === "cards");
    assert.equal(
      cards.options.card.component.componentName,
      "DmsMarketingWebsiteCard",
    );
    // About twice the default width; a dms without the option drops it.
    if ("minWidth" in cards.options.card) {
      assert.equal(cards.options.card.minWidth, "500px");
    }
    assert.equal(options.rowClick, "single");
    assert.equal(options.realtimeTopic, WEBSITES_REALTIME_TOPIC);
  });

  test("a card opens the site's settings in a deep-linked modal, and nothing else writes", () => {
    const { rowActions } = tableOptions();
    const [settings] = rowActions.custom;
    assert.equal(rowActions.custom.length, 1);
    assert.equal(settings.isDefault, true);
    assert.equal(settings.deepLink, true);
    assert.equal(settings.target.type, "modal");
    assert.equal(
      settings.target.component.componentName,
      "DmsMarketingWebsiteSettings",
    );
    for (const action of ["add", "edit", "delete", "duplicate", "details"]) {
      assert.ok(!rowActions[action], `${action} is not offered`);
    }
  });
});
