const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const { setConfig } = require("../dist/config");
const { MarketingEventsModel, MarketingSessionsModel } = require("../dist/db");
const { processCollectBatch } = require("../dist/services/collect");
const {
  forgetAcceptedSources,
  listRejectedSources,
  warnRejectedSource,
} = require("../dist/services/origin-guard");
const { clientIp } = require("../dist/services/request-meta");
const { sanitizeSnapshotHtml } = require("../dist/services/snapshots");
const { trackedEventSchema } = require("../dist/types/events");
const {
  MAX_EVENT_NAME_LENGTH,
  MAX_EXPERIMENT_KEY_LENGTH,
  MAX_TITLE_LENGTH,
} = require("../dist/types/constants");

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEBSITE = {
  _id: "ingest-site",
  tenantId: "ingest-tenant",
  domain: "example.com",
};
const PAGE = "https://example.com/landing";
let visitorCount = 0;
let store;

/**
 * In-memory stand-ins for the three models collect writes. The session the
 * fake stores is the very object the session cache holds — as on one
 * instance, where `touchSession` keeps it current — so `recordActivity`
 * has nothing left to do.
 */
function fakeModels() {
  store = { events: [], sessions: [], rows: [] };
  const sessions = {
    async findLatestForVisitor(websiteId, visitorId) {
      return store.sessions
        .filter((s) => s.websiteId === websiteId && s.visitorId === visitorId)
        .sort((a, b) => b.startedAt - a.startedAt)[0];
    },
    async insert(session) {
      store.sessions.push(session);
    },
    async recordActivity() {},
  };
  const events = {
    async insertMany(docs) {
      store.events.push(...docs);
      return docs.length;
    },
  };
  const statistics = {
    async get() {
      return undefined;
    },
    async insert(row) {
      store.rows.push(row);
    },
    async addDelta() {},
  };
  mock.method(models, "GetModel", (Model) => {
    if (Model === MarketingEventsModel) {
      return events;
    }
    return Model === MarketingSessionsModel ? sessions : statistics;
  });
}

/** A fresh visitor per test: the session cache outlives each case. */
function newVisitor() {
  visitorCount += 1;
  return { ip: `203.0.113.${visitorCount}`, userAgent: "Mozilla/5.0 test" };
}

function pageview(url = PAGE, extra = {}) {
  return { kind: "pageview", url, ...extra };
}

/**
 * Scoped to a describe: the root hooks of the other files mock GetModel too,
 * and a root hook here would run before theirs.
 */
function useFakeModels() {
  beforeEach(() => {
    setConfig({ visitorHashSecret: "ingest-test" });
    fakeModels();
  });

  afterEach(() => {
    mock.restoreAll();
    mock.timers.reset();
    setConfig();
  });
}

describe("a collect batch", () => {
  useFakeModels();

  test("an invalid event is dropped alone, the rest of its batch is kept", async () => {
    const outcome = await processCollectBatch(
      WEBSITE,
      [
        pageview(PAGE, { title: "t".repeat(MAX_TITLE_LENGTH + 71) }),
        {
          kind: "custom",
          url: PAGE,
          name: "n".repeat(MAX_EVENT_NAME_LENGTH + 1),
        },
        { kind: "custom", url: PAGE, name: "n".repeat(MAX_EVENT_NAME_LENGTH) },
        { kind: "click", url: PAGE, data: { x: -5, y: 0.5, dx: "abc" } },
        { kind: "scroll", url: PAGE, data: { depth: 101 } },
        pageview("javascript:alert(1)"),
        "not an event",
      ],
      newVisitor(),
    );
    assert.deepEqual(outcome, { accepted: 2, dropped: 5 });
    assert.deepEqual(
      store.events.map((event) => [event.kind, event.url]),
      [
        ["pageview", "/landing"],
        ["custom", "/landing"],
      ],
    );
  });

  test("an event and its daily row are dated by the same clock", async () => {
    // Years before the other cases, whose late rollup writes may land here.
    const midnight = Date.UTC(2020, 0, 2);
    mock.timers.enable({ apis: ["Date"], now: midnight + 60_000 });
    await processCollectBatch(
      WEBSITE,
      [pageview(PAGE, { at: midnight - 60_000 })],
      newVisitor(),
    );
    const ownRows = () => store.rows.filter((row) => row.day < midnight + DAY);
    // The rollup write is fire-and-forget.
    for (let tick = 0; tick < 20 && ownRows().length === 0; tick += 1) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(store.events[0].day, midnight - DAY);
    assert.deepEqual(
      ownRows().map((row) => row.day),
      [midnight - DAY],
    );
  });
});

describe("collect sessions", () => {
  useFakeModels();

  test("a new campaign during a visit opens a session of its own", async () => {
    const visitor = newVisitor();
    const campaign = `${PAGE}?utm_source=news&utm_medium=email&utm_campaign=spring`;
    await processCollectBatch(WEBSITE, [pageview()], visitor);
    await processCollectBatch(WEBSITE, [pageview(campaign)], visitor);
    // A reload of the campaign URL and an internal link stay in that session.
    await processCollectBatch(WEBSITE, [pageview(campaign)], visitor);
    await processCollectBatch(
      WEBSITE,
      [pageview("https://example.com/pricing")],
      visitor,
    );
    await processCollectBatch(
      WEBSITE,
      [pageview(`${PAGE}?gclid=abc`)],
      visitor,
    );
    assert.deepEqual(
      store.sessions.map((s) => [
        s.utmCampaign,
        s.clickIdParam,
        s.isNewVisitor,
      ]),
      [
        [undefined, undefined, true],
        ["spring", undefined, false],
        [undefined, "gclid", false],
      ],
    );
    assert.equal(store.sessions[1].pageviewsCount, 3);
  });

  test("only a pageview opens a session", async () => {
    const visitor = newVisitor();
    const click = { kind: "click", url: PAGE, data: { x: 0.5, y: 0.5 } };
    const orphan = await processCollectBatch(WEBSITE, [click], visitor);
    assert.deepEqual(orphan, { accepted: 0, dropped: 1 });
    assert.equal(store.sessions.length, 0);

    await processCollectBatch(WEBSITE, [pageview()], visitor);
    // Half an hour later, still on the page: the click joins the old session.
    store.sessions[0].lastSeenAt = new Date(Date.now() - HOUR);
    const late = await processCollectBatch(WEBSITE, [click], visitor);
    assert.deepEqual(late, { accepted: 1, dropped: 0 });
    assert.equal(store.sessions.length, 1);
    assert.equal(store.events.at(-1).sessionId, store.sessions[0]._id);
  });

  test("a session starts at its first event, not at the batch's arrival", async () => {
    const at = Date.now() - 4_000;
    await processCollectBatch(WEBSITE, [pageview(PAGE, { at })], newVisitor());
    assert.equal(store.sessions[0].startedAt.getTime(), at);
  });
});

test("over-long context is cut, not refused", () => {
  const parsed = trackedEventSchema.parse(
    pageview(PAGE, {
      title: "t".repeat(MAX_TITLE_LENGTH + 1),
      referrer: `https://ref.example/${"r".repeat(600)}`,
      language: "x".repeat(40),
    }),
  );
  assert.equal(parsed.title.length, MAX_TITLE_LENGTH);
  assert.equal(parsed.referrer.length, 500);
  assert.equal(parsed.language.length, 16);
});

test("a pageview keeps the sampling rate it declares, and nothing else", () => {
  assert.deepEqual(
    trackedEventSchema.parse(pageview(PAGE, { data: { sample: 0.25 } })).data,
    { sample: 0.25 },
  );
  const junk = trackedEventSchema.safeParse(
    pageview(PAGE, { data: { sample: 2, other: "x" } }),
  );
  assert.equal(junk.success, true);
  assert.equal(junk.data.data, undefined);
});

test("every experiment key the builder accepts can be exposed", () => {
  const exposure = (key) => ({
    kind: "exposure",
    url: PAGE,
    name: key,
    data: { experiment: key, variation: "b" },
  });
  const longest = "k".repeat(MAX_EXPERIMENT_KEY_LENGTH);
  assert.ok(MAX_EXPERIMENT_KEY_LENGTH > MAX_EVENT_NAME_LENGTH);
  assert.equal(trackedEventSchema.safeParse(exposure(longest)).success, true);
  assert.equal(
    trackedEventSchema.safeParse(exposure(`${longest}k`)).success,
    false,
  );
});

test("X-Forwarded-For is ignored unless proxies are declared", () => {
  const context = (forwarded) => ({
    rawRequest: {
      headers: { "x-forwarded-for": forwarded },
      socket: { remoteAddress: "10.0.0.9" },
    },
  });
  setConfig();
  try {
    assert.equal(clientIp(context("198.51.100.7")), "10.0.0.9");

    setConfig({ trustedProxyHops: 1 });
    assert.equal(clientIp(context("6.6.6.6, 198.51.100.7")), "198.51.100.7");
    assert.equal(
      clientIp(context(["6.6.6.6", "7.7.7.7, 198.51.100.7"])),
      "198.51.100.7",
    );
    assert.equal(clientIp(context(undefined)), "10.0.0.9");

    setConfig({ trustedProxyHops: 2 });
    assert.equal(
      clientIp(context("6.6.6.6, 198.51.100.7, 10.0.0.2")),
      "198.51.100.7",
    );
    assert.equal(clientIp(context("198.51.100.7")), "10.0.0.9");
  } finally {
    setConfig();
  }
});

test("a stored snapshot carries nothing executable and no form value", () => {
  const html = sanitizeSnapshotHtml(
    '<!DOCTYPE html><html><head><script>alert(1)</script><meta http-equiv="refresh" content="0;url=https://evil.example"></head>' +
      '<body><img src="x.png" onerror="alert(2)"><a href="javascript:alert(3)">x</a>' +
      '<input value="secret"><textarea>typed</textarea><li value="3">kept</li></body></html>',
  );
  assert.match(
    html,
    /^<!DOCTYPE html><meta http-equiv="Content-Security-Policy"/,
  );
  assert.doesNotMatch(html, /alert|secret|typed|refresh/);
  assert.match(html, /<img src="x.png">/);
  assert.match(html, /<li value="3">kept<\/li>/);
});

test("only browser-stamped hostnames are offered for Allow this host", () => {
  const browser = { "sec-fetch-mode": "no-cors" };
  warnRejectedSource(WEBSITE._id, "null", browser);
  warnRejectedSource(WEBSITE._id, "scripted.example", {});
  warnRejectedSource(WEBSITE._id, "staging.example", browser);
  warnRejectedSource(WEBSITE._id, "other.example", browser);
  assert.deepEqual(
    listRejectedSources(WEBSITE._id)
      .map((source) => source.hostname)
      .sort(),
    ["other.example", "staging.example"],
  );
  forgetAcceptedSources({ ...WEBSITE, extraDomains: ["staging.example"] });
  assert.deepEqual(
    listRejectedSources(WEBSITE._id).map((source) => source.hostname),
    ["other.example"],
  );
});
