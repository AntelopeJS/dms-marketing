const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const { setConfig } = require("../dist/config");
const {
  FunnelsModel,
  MarketingEventsModel,
  MarketingImportsModel,
  MarketingSessionsModel,
  WebsiteStatisticsModel,
  WebsitesModel,
} = require("../dist/db");
const { importAnalytics } = require("../dist/services/analytics-import");
const { processCollectBatch } = require("../dist/services/collect");

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ORIGIN = "https://shop.example.com";
/** Three days ago at midnight UTC: well inside every retention. */
const DAY_ONE = Math.floor((Date.now() - 3 * DAY) / DAY) * DAY;
let runCount = 0;
let store;

/**
 * In-memory stand-ins for every model collect and the import touch. The
 * statistics fake applies deltas as the database's increments do, so two
 * runs can be compared row for row.
 */
function fakeModels() {
  store = {
    websites: new Map(),
    funnels: [],
    events: [],
    sessions: [],
    stats: new Map(),
    imports: new Map(),
  };
  const sessions = {
    async findLatestForVisitor(websiteId, visitorId) {
      const row = store.sessions
        .filter((s) => s.websiteId === websiteId && s.visitorId === visitorId)
        .sort((a, b) => b.startedAt - a.startedAt)[0];
      return row && structuredClone(row);
    },
    async insert(session) {
      store.sessions.push(structuredClone(session));
    },
    async recordActivity(id, delta) {
      const session = store.sessions.find((s) => s._id === id);
      session.pageviewsCount += delta.pageviews;
      session.eventsCount += delta.events;
      if (delta.lastSeenAt !== undefined) session.lastSeenAt = delta.lastSeenAt;
      if (delta.exitUrl !== undefined) session.exitUrl = delta.exitUrl;
    },
  };
  const events = {
    async insertMany(docs) {
      store.events.push(...docs);
      return docs.length;
    },
  };
  const statistics = {
    async get(id) {
      const row = store.stats.get(id);
      return row && structuredClone(row);
    },
    async insert(row) {
      store.stats.set(row._id, structuredClone(row));
    },
    async addDelta(id, delta, tops) {
      const row = store.stats.get(id);
      for (const field of [
        "pageviews",
        "sessions",
        "newVisitors",
        "customEvents",
        "bouncedSessions",
        "sessionDurationMs",
      ]) {
        row[field] = (row[field] ?? 0) + delta[field];
      }
      row.tops = structuredClone(tops);
    },
  };
  const imports = {
    async get(id) {
      const row = store.imports.get(id);
      return row && { ...row };
    },
    async insert(row) {
      if (store.imports.has(row._id)) {
        throw new Error("duplicate key");
      }
      store.imports.set(row._id, { ...row });
    },
    async update(id, patch) {
      store.imports.set(id, { ...store.imports.get(id), ...patch });
    },
    async listByWebsite(websiteId) {
      return [...store.imports.values()].filter(
        (row) => row.websiteId === websiteId,
      );
    },
    async releaseClaim(id, token) {
      if (store.imports.get(id)?.claimToken === token) {
        store.imports.delete(id);
      }
    },
  };
  const websites = {
    async get(id) {
      return store.websites.get(id);
    },
  };
  const funnels = {
    async listByWebsite(websiteId) {
      return store.funnels.filter((funnel) => funnel.websiteId === websiteId);
    },
  };
  const byModel = new Map([
    [MarketingSessionsModel, sessions],
    [MarketingEventsModel, events],
    [WebsiteStatisticsModel, statistics],
    [MarketingImportsModel, imports],
    [WebsitesModel, websites],
    [FunnelsModel, funnels],
  ]);
  mock.method(models, "GetModel", (Model) => byModel.get(Model));
}

/** A website id per test: the session cache outlives each case. */
function website(name) {
  runCount += 1;
  const site = {
    _id: `${name}-${runCount}`,
    tenantId: "default",
    name,
    domain: "shop.example.com",
    trackingEnabled: true,
  };
  store.websites.set(site._id, site);
  return site;
}

function at(day, hours, minutes, seconds = 0) {
  return DAY_ONE + day * DAY + ((hours * 60 + minutes) * 60 + seconds) * 1000;
}

/**
 * Two visitors over two days: a campaign landing mid-visit, an idle gap, a
 * custom event, a visit across midnight and a scroll depth.
 */
const HISTORY = [
  {
    visitor: "a",
    userAgent: CHROME,
    events: [
      {
        kind: "pageview",
        at: at(0, 10, 0),
        url: `${ORIGIN}/`,
        referrer: "https://www.google.com/",
      },
      { kind: "custom", at: at(0, 10, 0, 3), url: `${ORIGIN}/`, name: "cta" },
      { kind: "pageview", at: at(0, 10, 2), url: `${ORIGIN}/pricing` },
      {
        kind: "pageview",
        at: at(0, 10, 12),
        url: `${ORIGIN}/pricing?utm_source=news&utm_medium=email&utm_campaign=spring`,
      },
      {
        kind: "custom",
        at: at(0, 10, 13),
        url: `${ORIGIN}/pricing`,
        name: "quote_submitted",
      },
      { kind: "pageview", at: at(0, 11, 30), url: `${ORIGIN}/` },
      { kind: "pageview", at: at(1, 9, 0), url: `${ORIGIN}/blog` },
    ],
  },
  {
    visitor: "b",
    userAgent: IPHONE,
    events: [
      { kind: "pageview", at: at(0, 23, 59, 58), url: `${ORIGIN}/` },
      { kind: "pageview", at: at(1, 0, 0, 30), url: `${ORIGIN}/pricing` },
      {
        kind: "scroll",
        at: at(1, 0, 1),
        url: `${ORIGIN}/pricing`,
        data: { depth: 80 },
      },
    ],
  },
];

/** Lets the fire-and-forget rollups of the live path land. */
async function drain() {
  for (let tick = 0; tick < 20; tick += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/** The tracker's way: one beacon per event, sent when it happened. */
async function collectLive(site) {
  const beacons = HISTORY.flatMap((session, index) =>
    session.events.map((event) => ({
      event,
      meta: {
        ip: `198.51.100.${runCount * 10 + index}`,
        userAgent: session.userAgent,
      },
    })),
  ).sort((x, y) => x.event.at - y.event.at);
  for (const { event, meta } of beacons) {
    mock.timers.reset();
    mock.timers.enable({ apis: ["Date"], now: event.at });
    await processCollectBatch(site, [event], meta);
    await drain();
  }
  mock.timers.reset();
}

/** The rows of a site, without what names the site. */
function dayRows(siteId) {
  return [...store.stats.values()]
    .filter((row) => row.websiteId === siteId)
    .sort((x, y) => x.day - y.day)
    .map(({ _id, websiteId, ...row }) => row);
}

/** Fresh fakes and a known secret per case. */
function useFakeModels() {
  beforeEach(() => {
    setConfig({ visitorHashSecret: "import-test" });
    fakeModels();
  });

  afterEach(() => {
    mock.restoreAll();
    mock.timers.reset();
    setConfig();
  });
}

describe("an analytics import", () => {
  useFakeModels();

  test("rolls history up exactly as live collection did", async () => {
    const live = website("live");
    await collectLive(live);
    const imported = website("imported");
    const result = await importAnalytics({
      importId: "history-2026",
      websiteId: imported._id,
      sessions: HISTORY.map((session) => ({
        ...session,
        visitor: `${session.visitor}-${runCount}`,
      })),
    });
    assert.deepEqual(result, {
      importId: "history-2026",
      status: "imported",
      sessions: 5,
      events: 10,
      dropped: 0,
    });
    const rows = dayRows(imported._id);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows, dayRows(live._id));
    assert.equal(rows[0].sessions, 4);
    assert.equal(rows[0].tops.topCampaigns !== undefined, true);
    // Raw events keep their own timestamps, not the import's clock.
    const ownEvents = store.events.filter((e) => e.websiteId === imported._id);
    assert.deepEqual(
      ownEvents.map((e) => e.timestamp.getTime()).sort((x, y) => x - y),
      HISTORY.flatMap((s) => s.events.map((e) => e.at)).sort((x, y) => x - y),
    );
  });
});

describe("an analytics import's chronology", () => {
  useFakeModels();

  test("rejects older windows before writing, even for another visitor", async () => {
    const site = website("ordered");
    const batch = (importId, hour, visitor = "same") => ({
      importId,
      websiteId: site._id,
      sessions: [
        {
          visitor,
          events: [{ kind: "pageview", at: at(0, hour, 0), url: "/" }],
        },
      ],
    });
    await importAnalytics(batch("later", 12));
    const before = structuredClone({
      events: store.events,
      sessions: store.sessions,
      stats: [...store.stats],
    });
    await assert.rejects(
      importAnalytics(batch("earlier", 10)),
      /chronological/,
    );
    await assert.rejects(
      importAnalytics(batch("other-visitor", 11, "other")),
      /chronological/,
    );
    assert.deepEqual(
      {
        events: store.events,
        sessions: store.sessions,
        stats: [...store.stats],
      },
      before,
    );
    // A preflight refusal does not consume the import id; equal instants are allowed.
    assert.equal((await importAnalytics(batch("earlier", 12))).events, 1);
    assert.equal((await importAnalytics(batch("next", 14))).sessions, 1);
  });

  test("reads another instance's session changes instead of its cached counters", async () => {
    const site = website("durable-session");
    const batch = (importId, minute) => ({
      importId,
      websiteId: site._id,
      sessions: [
        {
          visitor: "same",
          events: [{ kind: "pageview", at: at(0, 10, minute), url: "/" }],
        },
      ],
    });
    await importAnalytics(batch("first", 0));
    // Another instance has completed a pageview at 10:20 in this visit.
    Object.assign(store.sessions[0], {
      lastSeenAt: new Date(at(0, 10, 20)),
      pageviewsCount: 2,
      eventsCount: 2,
    });
    const stats = [...store.stats.values()][0];
    Object.assign(stats, {
      pageviews: 2,
      bouncedSessions: 0,
      sessionDurationMs: 20 * MINUTE,
    });
    assert.equal((await importAnalytics(batch("next", 25))).sessions, 0);
    assert.equal(store.sessions[0].pageviewsCount, 3);
    assert.equal(dayRows(site._id)[0].sessionDurationMs, 25 * MINUTE);
    assert.equal(dayRows(site._id)[0].bouncedSessions, 0);
  });
});

describe("an analytics import's claims", () => {
  useFakeModels();

  test("a failed replay blocks later imports", async () => {
    const site = website("failed");
    const batch = (importId) => ({
      importId,
      websiteId: site._id,
      sessions: HISTORY,
    });
    const events = models.GetModel(MarketingEventsModel);
    mock.method(events, "insertMany", async () => {
      throw new Error("storage failed");
    });
    await assert.rejects(importAnalytics(batch("first")), /failed part-way/);
    assert.equal((await importAnalytics(batch("first"))).status, "skipped");
    await assert.rejects(importAnalytics(batch("next")), /another import/);
    assert.equal(store.events.length, 0);
  });

  test("legacy claims without a chronology boundary require reconciliation", async () => {
    const site = website("legacy");
    store.imports.set(`${site._id}:old`, {
      _id: `${site._id}:old`,
      websiteId: site._id,
      importId: "old",
      status: "done",
      events: 1,
    });
    await assert.rejects(
      importAnalytics({
        importId: "new",
        websiteId: site._id,
        sessions: HISTORY,
      }),
      /reconciliation/,
    );
    assert.equal(store.events.length, 0);
    assert.equal(store.imports.has(`${site._id}:new`), false);
  });

  test("different import ids cannot replay the same website concurrently", async () => {
    const site = website("exclusive");
    const batch = (importId) => ({
      importId,
      websiteId: site._id,
      sessions: HISTORY,
    });
    const results = await Promise.allSettled([
      importAnalytics(batch("a")),
      importAnalytics(batch("b")),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.match(
      results.find((r) => r.status === "rejected").reason.message,
      /another import/,
    );
    assert.equal(store.events.length, 10);
  });

  test("an import id is applied once, even when two calls race", async () => {
    const site = website("once");
    const batch = {
      importId: "seed",
      websiteId: site._id,
      sessions: [{ ...HISTORY[1], visitor: `b-${runCount}` }],
    };
    const [first, second] = await Promise.all([
      importAnalytics(batch),
      importAnalytics(batch),
    ]);
    assert.deepEqual(
      [first.status, second.status].sort((x, y) => x.localeCompare(y)),
      ["imported", "skipped"],
    );
    const again = await importAnalytics({ ...batch, sessions: HISTORY });
    assert.equal(again.status, "skipped");
    assert.equal(again.events, 3);
    assert.equal(
      store.events.filter((e) => e.websiteId === site._id).length,
      3,
    );
    assert.equal(store.imports.get(`${site._id}:seed`).status, "done");
  });
});

describe("an analytics import's guards", () => {
  useFakeModels();

  test("what live collection would refuse, or nothing could read, is dropped", async () => {
    const site = website("drops");
    store.funnels.push(
      {
        websiteId: site._id,
        experiment: { key: "live-split", status: "stopped" },
      },
      {
        websiteId: site._id,
        experiment: { key: "draft-split", status: "draft" },
      },
    );
    const exposure = (key) => ({
      kind: "exposure",
      at: at(0, 9, 0, 1),
      url: `${ORIGIN}/`,
      name: key,
      data: { experiment: key, variation: "b" },
    });
    const result = await importAnalytics({
      importId: "with-drops",
      websiteId: site._id,
      sessions: [
        {
          visitor: `c-${runCount}`,
          country: "be",
          events: [
            { kind: "pageview", at: at(0, 9, 0), url: `${ORIGIN}/` },
            exposure("live-split"),
            exposure("draft-split"),
            { kind: "pageview", at: Date.now() + DAY, url: `${ORIGIN}/future` },
            {
              kind: "pageview",
              at: Date.now() - 800 * DAY,
              url: `${ORIGIN}/old`,
            },
            { kind: "pageview", at: "not a date", url: `${ORIGIN}/` },
            { kind: "teleport", at: at(0, 9, 1), url: `${ORIGIN}/` },
          ],
        },
        {
          visitor: `bot-${runCount}`,
          userAgent: "Googlebot/2.1 (+http://www.google.com/bot.html)",
          events: [{ kind: "pageview", at: at(0, 9, 0), url: `${ORIGIN}/` }],
        },
        {
          visitor: `orphan-${runCount}`,
          events: [{ kind: "custom", name: "buy", at: at(0, 10, 0), url: "/" }],
        },
      ],
    });
    assert.deepEqual(
      { events: result.events, dropped: result.dropped },
      { events: 2, dropped: 7 },
    );
    const session = store.sessions.find((s) => s.websiteId === site._id);
    assert.equal(session.country, "BE");
  });

  test("an unknown website, another tenant's or a bad id is refused", async () => {
    const site = website("refusals");
    await assert.rejects(
      importAnalytics({ importId: "x", websiteId: "nowhere", sessions: [] }),
      /ImportAnalytics\("x"\): no website "nowhere" in the tenant "default"/,
    );
    await assert.rejects(
      importAnalytics({
        importId: "x",
        tenantId: "tenant-b",
        websiteId: site._id,
        sessions: [],
      }),
      /in the tenant "tenant-b"/,
    );
    await assert.rejects(
      importAnalytics({ importId: "a b", websiteId: site._id, sessions: [] }),
      /the id must be 1-64 letters/,
    );
    await assert.rejects(
      importAnalytics({
        importId: "x",
        websiteId: site._id,
        sessions: [{ events: [] }],
      }),
      /sessions\.0\.visitor/,
    );
  });
});
