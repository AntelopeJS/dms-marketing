const { mock } = require("node:test");
const models = require("@antelopejs/interface-database-decorators/model");
const { setConfig } = require("../../dist/config");
const {
  FunnelsModel,
  MarketingEventsModel,
  MarketingImportsModel,
  MarketingSessionsModel,
  WebsiteStatisticsModel,
  WebsitesModel,
} = require("../../dist/db");

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ORIGIN = "https://shop.example.com";
/**
 * The 10th of last month at midnight UTC: well inside every retention, and the
 * two days of history stay in one month, the period of the visitor-id salt.
 */
const DAY_ONE = (() => {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 10);
})();
const COUNTERS = [
  "pageviews",
  "sessions",
  "newVisitors",
  "customEvents",
  "bouncedSessions",
  "sessionDurationMs",
];
let runCount = 0;
let claimSwaps = 0;
/** @typedef {Record<string, unknown>} Row */
/** @type {{ websites: Map<unknown, Row>, funnels: Row[], events: Row[], sessions: Row[], stats: Map<unknown, Row>, imports: Map<unknown, Row> }} */
let store;

function fakeSessions() {
  return {
    async listImported(websiteId, importId) {
      return store.sessions.filter(
        (s) => s.websiteId === websiteId && s.importId === importId,
      );
    },
    async deleteMany(ids) {
      store.sessions = store.sessions.filter((s) => !ids.includes(s._id));
    },
    async restoreActivity(id, events) {
      const session = store.sessions.find((s) => s._id === id);
      const pageviews = events.filter((e) => e.kind === "pageview");
      session.pageviewsCount = pageviews.length;
      session.eventsCount = events.length;
      session.lastSeenAt = events[events.length - 1].timestamp;
      session.exitUrl = pageviews[pageviews.length - 1].url;
    },
    async findLatestForVisitor(websiteId, visitorId) {
      const row = store.sessions
        .filter((s) => s.websiteId === websiteId && s.visitorId === visitorId)
        .sort((a, b) => b.startedAt - a.startedAt)[0];
      return row && structuredClone(row);
    },
    /** @param {Row} session */
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
}

function fakeEvents() {
  return {
    /** @param {Row[]} docs */
    async insertMany(docs) {
      store.events.push(...docs);
      return docs.length;
    },
    async listImported(websiteId, importId) {
      return store.events.filter(
        (e) => e.websiteId === websiteId && e.importId === importId,
      );
    },
    async listBySession(websiteId, sessionId) {
      return store.events
        .filter((e) => e.websiteId === websiteId && e.sessionId === sessionId)
        .sort((a, b) => a.timestamp - b.timestamp);
    },
    async deleteImportedOnDay(websiteId, importId, day) {
      store.events = store.events.filter(
        (e) =>
          e.websiteId !== websiteId || e.importId !== importId || e.day !== day,
      );
    },
  };
}

function fakeStatistics() {
  return {
    async get(id) {
      const row = store.stats.get(id);
      return row && structuredClone(row);
    },
    /** @param {Row} row */
    async insert(row) {
      store.stats.set(row._id, structuredClone(row));
    },
    async getDaysSince(websiteId) {
      return [...store.stats.values()]
        .filter((row) => row.websiteId === websiteId)
        .map((row) => structuredClone(row));
    },
    async addDelta(id, delta, tops, appliedImports) {
      const row = store.stats.get(id);
      if (appliedImports) row.appliedImports = structuredClone(appliedImports);
      for (const field of COUNTERS) {
        row[field] = (row[field] ?? 0) + delta[field];
      }
      row.tops = structuredClone(tops);
    },
  };
}

function fakeImports() {
  return {
    async get(id) {
      const row = store.imports.get(id);
      return row && { ...row };
    },
    /** @param {Row} row */
    async insert(row) {
      if (store.imports.has(row._id)) {
        throw new Error("duplicate key");
      }
      store.imports.set(row._id, { ...row });
    },
    /** @param {Row} patch */
    async update(id, patch) {
      store.imports.set(id, { ...store.imports.get(id), ...patch });
    },
    async listByWebsite(websiteId) {
      return [...store.imports.values()].filter(
        (row) => row.websiteId === websiteId,
      );
    },
    async swapClaim(id, token) {
      const row = store.imports.get(id);
      if (row?.claimToken !== token) return undefined;
      claimSwaps += 1;
      row.claimToken = `swapped-${claimSwaps}`;
      return row.claimToken;
    },
    async releaseClaim(id, token) {
      if (store.imports.get(id)?.claimToken === token) {
        store.imports.delete(id);
      }
    },
  };
}

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
  const byModel = new Map([
    [MarketingSessionsModel, fakeSessions()],
    [MarketingEventsModel, fakeEvents()],
    [WebsiteStatisticsModel, fakeStatistics()],
    [MarketingImportsModel, fakeImports()],
    [
      WebsitesModel,
      {
        async get(id) {
          return store.websites.get(id);
        },
      },
    ],
    [
      FunnelsModel,
      {
        async listByWebsite(websiteId) {
          return store.funnels.filter(
            (funnel) => funnel.websiteId === websiteId,
          );
        },
      },
    ],
  ]);
  mock.method(
    models,
    "GetModel",
    /** @param {unknown} Model */ (Model) => byModel.get(Model),
  );
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

/** The rows of a site, without what names the site. */
function dayRows(siteId) {
  return [...store.stats.values()]
    .filter((row) => row.websiteId === siteId)
    .sort((x, y) => x.day - y.day)
    .map(({ _id, websiteId, appliedImports, ...row }) => row);
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

module.exports = {
  DAY,
  DAY_ONE,
  HISTORY,
  ORIGIN,
  at,
  dayRows,
  drain,
  runCount: () => runCount,
  store: () => store,
  useFakeModels,
  website,
};
