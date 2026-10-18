const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const { ControllerMeta } = require("@antelopejs/interface-api");
const { GetMetadata } = require("@antelopejs/interface-core");
const models = require("@antelopejs/interface-database-decorators/model");
const {
  FunnelsModel,
  MarketingEventsModel,
  MarketingImportsModel,
  MarketingSessionsModel,
  PageSnapshotsModel,
  WebsiteStatisticsModel,
  WebsitesModel,
} = require("../dist/db");
const { WebsitesController } = require("../dist/routes/websites");
const { dashboardWebsiteId } = require("../dist/services/dashboard-tracking");

const TENANT = "default";
/**
 * A request of the default tenant, as the JWT fallback reads it; a fresh one
 * per call, since a guard keeps what it resolved on its request.
 */
const tenantRequest = () => ({ rawRequest: { headers: {} } });
const OWNER = { _id: "owner" };

const controller = Object.create(WebsitesController.prototype);

/** The status an HTTPResult rejection carries. */
const status = (code) => (error) => error.getStatus() === code;

// --- Guards ------------------------------------------------------------------

/** A websites table of three sites over fake tenant tables. */
function fakeStore() {
  const rows = { events: 5, funnels: 2 };
  const table = (key) => ({
    async deleteByWebsite() {
      const deleted = rows[key] ?? 0;
      rows[key] = 0;
      return deleted;
    },
  });
  const site = (id, tenantId) => ({ _id: id, tenantId, name: id });
  const websites = new Map(
    [
      site("guard-site", TENANT),
      site(dashboardWebsiteId(TENANT), TENANT),
      site("guard-foreign", "other"),
    ].map((website) => [website._id, website]),
  );
  const byModel = new Map([
    [MarketingEventsModel, table("events")],
    [MarketingSessionsModel, table("sessions")],
    [WebsiteStatisticsModel, table("days")],
    [PageSnapshotsModel, table("snapshots")],
    [MarketingImportsModel, table("imports")],
    [FunnelsModel, table("funnels")],
    [
      WebsitesModel,
      {
        get: async (id) => websites.get(id),
        delete: async (id) => void websites.delete(id),
      },
    ],
  ]);
  mock.method(models, "GetModel", (model) => byModel.get(model));
  return { rows, websites };
}

describe("deleting a website", () => {
  afterEach(() => mock.restoreAll());

  test("the dashboard's own site is refused with a 409, data and all kept", async () => {
    const { rows, websites } = fakeStore();
    const id = dashboardWebsiteId(TENANT);
    await assert.rejects(
      controller.remove(OWNER, id, tenantRequest()),
      (error) =>
        error.getStatus() === 409 &&
        String(error.getBody()).includes("dashboard_website_kept"),
    );
    assert.ok(websites.has(id));
    assert.equal(rows.events, 5);
  });

  test("any other site goes, with its data and its funnels", async () => {
    const { rows, websites } = fakeStore();
    assert.deepEqual(
      await controller.remove(OWNER, "guard-site", tenantRequest()),
      { deleted: "guard-site" },
    );
    assert.ok(!websites.has("guard-site"));
    assert.equal(rows.events, 0);
    assert.equal(rows.funnels, 0);
  });

  test("another tenant's site answers 404", async () => {
    const { websites } = fakeStore();
    await assert.rejects(
      controller.remove(OWNER, "guard-foreign", tenantRequest()),
      status(404),
    );
    assert.ok(websites.has("guard-foreign"));
  });
});

describe("the delete route", () => {
  /** What the route resolves its first parameter (the caller) with. */
  function callerProvider(handler) {
    const meta = GetMetadata(WebsitesController, ControllerMeta);
    return meta.getParameterArray(handler)[0].provider;
  }

  for (const handler of ["remove"]) {
    test(`${handler} takes a tenant owner, and refuses an anonymous call`, async () => {
      const provider = callerProvider(handler);
      // The owner variant of the tenant guard, the one `update` takes.
      assert.match(String(provider), /requireOwner: true/);
      assert.equal(String(provider), String(callerProvider("update")));
      await assert.rejects(provider(tenantRequest()), (error) =>
        [401, 403].includes(error.getStatus()),
      );
    });
  }
});
