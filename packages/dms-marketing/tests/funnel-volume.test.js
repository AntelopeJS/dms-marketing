const assert = require("node:assert/strict");
const test = it;
const { GetModel } = require("@antelopejs/interface-database-decorators");
const { EnsureWebsite } = require("@antelopejs/interface-dms-marketing");
const { MarketingEventsModel } = require("../dist/db");
const { funnelResultsIn } = require("../dist/services/funnels");
const { backfill, useRealModels } = require("./helpers/funnel-trail-checks");

const TENANT = "funnel-volume";
const WEBSITE_ID = "funnel-volume-site";
const SESSIONS = 70_000;
const PAGES = ["/a", "/b", "/c"];
const CHUNK = 10_000;
const DAY = 86_400_000;
const START = Date.now() - 2 * DAY;

const funnel = {
  websiteId: WEBSITE_ID,
  steps: PAGES.map((value) => ({ kind: "url", value })),
  conversionWindowMs: 3_600_000,
  experiment: null,
};

/** Every session views /a, /b and /c, each event on its own millisecond. */
function* rows() {
  for (let session = 0; session < SESSIONS; session++) {
    for (const [index, url] of PAGES.entries()) {
      const timestamp = new Date(START + session * 10 + index);
      yield {
        websiteId: WEBSITE_ID,
        timestamp,
        day: Math.floor(timestamp.getTime() / DAY) * DAY,
        kind: "pageview",
        sessionId: `volume-${session}`,
        visitorId: `volume-${session}`,
        url,
      };
    }
  }
}

describe("a funnel over more than 200,000 events", () => {
  useRealModels();
  before(async function () {
    this.timeout(120_000);
    await EnsureWebsite({
      id: WEBSITE_ID,
      tenantId: TENANT,
      name: WEBSITE_ID,
      domain: "volume.example",
    });
    const events = GetModel(MarketingEventsModel, TENANT);
    let chunk = [];
    for (const row of rows()) {
      chunk.push(row);
      if (chunk.length === CHUNK) {
        await events.insertMany(chunk);
        chunk = [];
      }
    }
    await backfill();
  });

  test("counts every event of the window", async function () {
    this.timeout(120_000);
    const results = await funnelResultsIn(funnel, TENANT, {
      since: new Date(START - DAY),
      until: new Date(START + DAY),
    });
    assert.deepEqual(
      {
        incomplete: results.incomplete,
        events: results.computation.events,
        steps: results.computation.steps.map((step) => step.sessions),
      },
      {
        incomplete: false,
        events: SESSIONS * PAGES.length,
        steps: [SESSIONS, SESSIONS, SESSIONS],
      },
    );
  });
});
