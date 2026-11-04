const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const models = require("@antelopejs/interface-database-decorators/model");
const { setConfig } = require("../dist/config");
const { MarketingEventsModel, MarketingSessionsModel } = require("../dist/db");
const { processCollectBatch } = require("../dist/services/collect");
const { dashboardWebsiteId } = require("../dist/services/dashboard-tracking");
const {
  forgetAcceptedSources,
  listRejectedSources,
  warnRejectedSource,
} = require("../dist/services/origin-guard");
const { parseJsonOr400 } = require("../dist/services/request-body");
const { getClientIp } = require("@antelopejs/interface-dms/client-ip");
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

/** @typedef {import("../dist/db").NewMarketingEvent} NewMarketingEvent */
/** @typedef {import("../dist/db").MarketingSession} MarketingSession */
/** @typedef {import("../dist/db").WebsiteStatistics} WebsiteStatistics */

/**
 * @typedef {object} Store
 * @property {NewMarketingEvent[]} events
 * @property {MarketingSession[]} sessions
 * @property {WebsiteStatistics[]} rows
 */

/** @type {Store} */
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
    /**
     * @param {string} websiteId
     * @param {string} visitorId
     */
    async findLatestForVisitor(websiteId, visitorId) {
      return store.sessions
        .filter((s) => s.websiteId === websiteId && s.visitorId === visitorId)
        .sort((a, b) => b.startedAt - a.startedAt)[0];
    },
    /** @param {MarketingSession} session */
    async insert(session) {
      store.sessions.push(session);
    },
    async recordActivity() {},
  };
  const events = {
    /** @param {NewMarketingEvent[]} docs */
    async insertMany(docs) {
      store.events.push(...docs);
      return docs.length;
    },
  };
  const statistics = {
    async get() {
      return undefined;
    },
    /** @param {WebsiteStatistics} row */
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

  test("the dashboard's website drops what its module area sends", async () => {
    const dashboard = {
      ...WEBSITE,
      _id: dashboardWebsiteId(WEBSITE.tenantId),
    };
    const origin = "https://example.com";
    const outcome = await processCollectBatch(
      dashboard,
      [
        pageview(`${origin}/modules`),
        pageview(`${origin}/modules/crm/customers?tab=2`),
        { kind: "custom", url: `${origin}/modules/store`, name: "install" },
        { kind: "click", url: `${origin}/Modules/crm`, data: { x: 1, y: 1 } },
        pageview(`${origin}/home`),
        pageview(`${origin}/modulesx`),
      ],
      newVisitor(),
    );
    assert.deepEqual(outcome, { accepted: 2, dropped: 4 });
    assert.deepEqual(
      store.events.map((event) => event.url),
      ["/home", "/modulesx"],
    );
  });

  test("any other website keeps a page of its own under /modules", async () => {
    const outcome = await processCollectBatch(
      WEBSITE,
      [pageview("https://example.com/modules/crm")],
      newVisitor(),
    );
    assert.deepEqual(outcome, { accepted: 1, dropped: 0 });
  });

  test("an event and its daily row are dated by the same clock", async () => {
    const midnight = Date.UTC(2020, 0, 2);
    mock.timers.enable({ apis: ["Date"], now: midnight + 60_000 });
    await processCollectBatch(
      WEBSITE,
      [pageview(PAGE, { at: midnight - 60_000 })],
      newVisitor(),
    );
    const ownRows = () => store.rows.filter((row) => row.day < midnight + DAY);
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
    store.sessions[0].lastSeenAt = new Date(Date.now() - HOUR);
    const late = await processCollectBatch(WEBSITE, [click], visitor);
    assert.deepEqual(late, { accepted: 1, dropped: 0 });
    assert.equal(store.sessions.length, 1);
    assert.equal(store.events.at(-1).sessionId, store.sessions[0]._id);
  });

  test("an interaction on an expired session does not revive it", async () => {
    const visitor = newVisitor();
    const scroll = { kind: "scroll", url: PAGE, data: { depth: 50 } };
    await processCollectBatch(WEBSITE, [pageview()], visitor);
    const expired = new Date(Date.now() - HOUR);
    store.sessions[0].lastSeenAt = expired;
    await processCollectBatch(WEBSITE, [scroll], visitor);
    assert.equal(store.sessions[0].lastSeenAt, expired);
    assert.equal(store.sessions[0].eventsCount, 2);
    assert.equal(store.sessions[0].exitUrl, "/landing");

    await processCollectBatch(
      WEBSITE,
      [pageview("https://example.com/pricing")],
      visitor,
    );
    assert.equal(store.sessions.length, 2);
    assert.equal(store.sessions[0].exitUrl, "/landing");
    assert.equal(store.events.at(-1).sessionId, store.sessions[1]._id);
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
  /** @param {string} key */
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

test("the client address is the DMS's: X-Forwarded-For needs a trusted proxy", async () => {
  /**
   * @param {string | undefined} forwarded
   * @param {string} [remoteAddress]
   */
  const context = (forwarded, remoteAddress = "10.0.0.9") => ({
    rawRequest: {
      headers: { "x-forwarded-for": forwarded },
      socket: { remoteAddress },
    },
  });
  assert.equal(await getClientIp(context("198.51.100.7")), "10.0.0.9");
  assert.equal(await getClientIp(context(undefined)), "10.0.0.9");
  assert.equal(
    await getClientIp(context(undefined, "::ffff:203.0.113.4")),
    "203.0.113.4",
  );
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
  assert.match(html, /<img src="x.png" \/>/);
  assert.match(html, /<li value="3">kept<\/li>/);
});

test("the snapshot sanitizer is not bypassed by parser tricks", () => {
  const html = sanitizeSnapshotHtml(
    '<img/onerror=alert(1) src="a.png"><svg/onload=alert(2)></svg>' +
      '<a href="&#106;avascript:alert(3)">a</a>' +
      '<a href="&#x6A;&#x61;vascript&colon;alert(4)">b</a>' +
      '<a href="java&#x09;script:alert(5)">c</a>' +
      '<a href=" JaVaScRiPt:alert(6)">d</a>' +
      '<svg><a xlink:href="javascript:alert(7)"><text>e</text></a></svg>' +
      '<img srcset="javascript:alert(8) 1x, b.png 2x">' +
      '<form action="javascript:alert(9)"><button formaction="javascript:alert(10)">f</button></form>' +
      '<div title="</div><script>steal()</script>">g</div>' +
      "<p>open <script>alert(12)",
  );
  assert.doesNotMatch(html, /alert|javascript|onerror|onload|<script/i);
  assert.match(html, /<img src="a.png" \/>/);
  assert.match(html, /<img srcset="b.png 2x" \/>/);
  assert.match(html, /<a>a<\/a><a>b<\/a><a>c<\/a><a>d<\/a>/);
  assert.match(html, /<div title="&lt;\/div&gt;&lt;script&gt;.*">g<\/div>/);
});

test("a sanitized snapshot keeps what renders the page", () => {
  const html = sanitizeSnapshotHtml(
    '<html><head><link rel="stylesheet" href="https://example.com/a.css" media="screen">' +
      "<style>.card > p { color: red }</style></head>" +
      '<body class="home" style="margin:0;background:url(&quot;https://example.com/bg.png&quot;)">' +
      '<nav hidden data-state="closed"><a href="#top">Top</a><a href="mailto:a@example.com">Mail</a></nav>' +
      '<img src="data:image/png;base64,AAAA" alt=""><br><wbr>' +
      '<svg viewBox="0 0 10 10"><use xlink:href="#icon"/></svg>' +
      '<my-widget theme="dark">x &amp; y &lt;z&gt;</my-widget>' +
      '<select><option selected value="v">Shown</option></select></body></html>',
  );
  assert.match(
    html,
    /<link rel="stylesheet" href="https:\/\/example.com\/a.css" media="screen" \/>/,
  );
  assert.match(html, /<style>\.card > p \{ color: red \}<\/style>/);
  assert.match(
    html,
    /<body class="home" style="margin:0;background:url\(&quot;https:\/\/example.com\/bg.png&quot;\)">/,
  );
  assert.match(
    html,
    /<nav hidden data-state="closed"><a href="#top">Top<\/a><a href="mailto:a@example.com">Mail<\/a><\/nav>/,
  );
  assert.match(
    html,
    /<img src="data:image\/png;base64,AAAA" alt="" \/><br \/><wbr \/>/,
  );
  assert.match(html, /<use xlink:href="#icon"><\/use>/);
  assert.match(
    html,
    /<my-widget theme="dark">x &amp; y &lt;z&gt;<\/my-widget>/,
  );
  assert.match(html, /<select><option>Shown<\/option><\/select>/);
  assert.doesNotMatch(html, /<\/(br|img|wbr)>/);
});

test("a stylesheet survives a < that opens no markup, never one that does", () => {
  const tailwind =
    "@media (width < 48rem){.a{display:none}}.b:has(> p){margin:0}";
  assert.match(
    sanitizeSnapshotHtml(`<style>${tailwind}</style>`),
    /<style>@media \(width < 48rem\)\{\.a\{display:none\}\}\.b:has\(> p\)\{margin:0\}<\/style>/,
  );
  const breakouts = [
    '<style>a{content:"</style><script>alert(1)</script>"}</style>',
    "<style>a{}</STYLE ><img src=x onerror=alert(2)></style>",
    "<svg><style><img src=x onerror=alert(3)></style></svg>",
    "<math><style><!--</style><img src=x onerror=alert(4)>--></style></math>",
  ];
  for (const breakout of breakouts) {
    assert.doesNotMatch(
      sanitizeSnapshotHtml(breakout),
      /alert|onerror|<script/i,
    );
  }
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

test("a capped body that is not JSON is a 400", () => {
  const anything = { parse: structuredClone };
  assert.deepEqual(parseJsonOr400(Buffer.from('{"a":1}'), anything), { a: 1 });
  assert.throws(
    () => {
      parseJsonOr400(Buffer.from("{not json"), anything);
    },
    (error) => error.getStatus() === 400 && error.getBody() === "invalid body",
  );
  assert.throws(
    () => {
      parseJsonOr400(Buffer.from(""), anything);
    },
    (error) => error.getStatus() === 400 && error.getBody() === "invalid body",
  );
});

test("a capped body its schema refuses is a 400", () => {
  const refusing = {
    parse() {
      throw new Error("refused");
    },
  };
  assert.throws(
    () => {
      parseJsonOr400(Buffer.from('{"name":1}'), refusing);
    },
    (error) =>
      error.getStatus() === 400 && error.getBody() === "Error: refused",
  );
});
