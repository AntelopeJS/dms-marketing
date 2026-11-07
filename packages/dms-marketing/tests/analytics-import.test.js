const assert = require("node:assert/strict");
const { mock } = require("node:test");
const test = it;
const { Events } = require("@antelopejs/interface-core/modules");
const models = require("@antelopejs/interface-database-decorators/model");
const { MarketingEventsModel } = require("../dist/db");
const { importAnalytics } = require("../dist/services/analytics-import");
const { processCollectBatch } = require("../dist/services/collect");
const MINUTE = 60_000;
const {
  DAY,
  HISTORY,
  NOW,
  ORIGIN,
  at,
  dayRows,
  drain,
  runCount,
  store,
  useFakeModels,
  website,
} = require("./helpers/analytics-import-fakes");

/**
 * The tracker's way: one beacon per event, sent when it happened.
 * @param {import("./helpers/analytics-import-fakes").TrackedSite} site
 */
async function collectLive(site) {
  const beacons = HISTORY.flatMap((session, index) =>
    session.events.map((event) => ({
      event,
      meta: {
        ip: `198.51.100.${runCount() * 10 + index}`,
        userAgent: session.userAgent,
      },
    })),
  ).sort((x, y) => x.event.at - y.event.at);
  for (const { event, meta } of beacons) {
    mock.timers.setTime(event.at);
    await processCollectBatch(site, [event], meta);
    await drain();
  }
  mock.timers.setTime(NOW);
}

describe("an analytics import", () => {
  useFakeModels();

  test("rolls history up exactly as live collection did", async () => {
    const live = website("live");
    await collectLive(live);
    const imported = website("imported");
    const result = await importAnalytics({
      tenantId: "default",
      importId: "history-2026",
      websiteId: imported._id,
      sessions: HISTORY.map((session) => ({
        ...session,
        visitor: `${session.visitor}-${runCount()}`,
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
    const ownEvents = store().events.filter(
      (e) => e.websiteId === imported._id,
    );
    assert.deepEqual(
      ownEvents.map((e) => e.timestamp.getTime()).sort((x, y) => x - y),
      HISTORY.flatMap((s) => s.events.map((e) => e.at)).sort((x, y) => x - y),
    );
  });
});

describe("an analytics import while the modules stop", () => {
  useFakeModels();

  afterEach(() => {
    Events.ModulesStarted.emit();
  });

  /**
   * Twelve visitors, more than the replay runs side by side, on three days.
   * @param {import("./helpers/analytics-import-fakes").TrackedSite} site
   */
  function batchFor(site) {
    return {
      tenantId: "default",
      importId: "history-stop",
      websiteId: site._id,
      sessions: Array.from({ length: 12 }, (_, visitor) => ({
        visitor: `v${visitor}`,
        events: [0, 1, 2].map((day) => ({
          kind: "pageview",
          at: at(day, 10, visitor),
          url: `${ORIGIN}/`,
        })),
      })),
    };
  }

  test("stops inside its first day, and a call after the restart finishes it exactly once", async () => {
    const whole = website("whole");
    const expected = await importAnalytics(batchFor(whole));

    const site = website("stopped");
    const stopping = mock.method(
      models.GetModel(MarketingEventsModel),
      "insertMany",
      /** @param {object[]} docs */ async (docs) => {
        Events.ModulesStopping.emit();
        store().events.push(...docs);
        return docs.length;
      },
    );
    await assert.rejects(
      importAnalytics(batchFor(site)),
      /failed part-way; call it again to resume: the modules are stopping/,
    );
    stopping.mock.restore();
    const written = store().events.filter((e) => e.websiteId === site._id);
    assert.ok(written.length > 0);
    assert.ok(written.length < 12);
    assert.ok(written.every((e) => e.timestamp.getTime() < at(1, 0, 0)));

    Events.ModulesStarted.emit();
    const resumed = await importAnalytics(batchFor(site));
    assert.deepEqual(
      [resumed.status, resumed.sessions, resumed.events],
      ["imported", expected.sessions, expected.events],
    );
    assert.equal(
      store().events.filter((e) => e.websiteId === site._id).length,
      expected.events,
    );
    assert.equal(
      store().sessions.filter((s) => s.websiteId === site._id).length,
      expected.sessions,
    );
    assert.deepEqual(dayRows(site._id), dayRows(whole._id));
  });
});

describe("an analytics import's chronology", () => {
  useFakeModels();

  test("rejects older windows before writing, even for another visitor", async () => {
    const site = website("ordered");
    /**
     * @param {string} importId
     * @param {number} hour
     * @param {string} [visitor]
     */
    const batch = (importId, hour, visitor = "same") => ({
      tenantId: "default",
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
      events: store().events,
      sessions: store().sessions,
      stats: [...store().stats],
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
        events: store().events,
        sessions: store().sessions,
        stats: [...store().stats],
      },
      before,
    );
    assert.equal((await importAnalytics(batch("earlier", 12))).events, 1);
    assert.equal((await importAnalytics(batch("next", 14))).sessions, 1);
  });

  test("reads another instance's session changes instead of its cached counters", async () => {
    const site = website("durable-session");
    /**
     * @param {string} importId
     * @param {number} minute
     */
    const batch = (importId, minute) => ({
      tenantId: "default",
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
    Object.assign(store().sessions[0], {
      lastSeenAt: new Date(at(0, 10, 20)),
      pageviewsCount: 2,
      eventsCount: 2,
    });
    const stats = [...store().stats.values()][0];
    Object.assign(stats, {
      pageviews: 2,
      bouncedSessions: 0,
      sessionDurationMs: 20 * MINUTE,
    });
    assert.equal((await importAnalytics(batch("next", 25))).sessions, 0);
    assert.equal(store().sessions[0].pageviewsCount, 3);
    assert.equal(dayRows(site._id)[0].sessionDurationMs, 25 * MINUTE);
    assert.equal(dayRows(site._id)[0].bouncedSessions, 0);
  });
});

describe("an analytics import's guards", () => {
  useFakeModels();

  test("what live collection would refuse, or nothing could read, is dropped", async () => {
    const site = website("drops");
    store().funnels.push(
      {
        websiteId: site._id,
        experiment: { key: "live-split", status: "stopped" },
      },
      {
        websiteId: site._id,
        experiment: { key: "draft-split", status: "draft" },
      },
    );
    /** @param {string} key */
    const exposure = (key) => ({
      kind: "exposure",
      at: at(0, 9, 0, 1),
      url: `${ORIGIN}/`,
      name: key,
      data: { experiment: key, variation: "b" },
    });
    const result = await importAnalytics({
      tenantId: "default",
      importId: "with-drops",
      websiteId: site._id,
      sessions: [
        {
          visitor: `c-${runCount()}`,
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
          visitor: `bot-${runCount()}`,
          userAgent: "Googlebot/2.1 (+http://www.google.com/bot.html)",
          events: [{ kind: "pageview", at: at(0, 9, 0), url: `${ORIGIN}/` }],
        },
        {
          visitor: `orphan-${runCount()}`,
          events: [{ kind: "custom", name: "buy", at: at(0, 10, 0), url: "/" }],
        },
      ],
    });
    assert.deepEqual(
      { events: result.events, dropped: result.dropped },
      { events: 2, dropped: 7 },
    );
    const session = store().sessions.find((s) => s.websiteId === site._id);
    assert.equal(session.country, "BE");
  });

  test("an unknown website, another tenant's or a bad id is refused", async () => {
    const batch = {
      tenantId: "default",
      importId: "x",
      websiteId: website("refusals")._id,
      sessions: [],
    };
    await assert.rejects(
      importAnalytics({ ...batch, websiteId: "nowhere" }),
      /ImportAnalytics\("x"\): no website "nowhere" in the tenant "default"/,
    );
    await assert.rejects(
      importAnalytics({ ...batch, tenantId: "tenant-b" }),
      /in the tenant "tenant-b"/,
    );
    await assert.rejects(
      importAnalytics({ ...batch, importId: "a b" }),
      /the id must be 1-64 letters/,
    );
    await assert.rejects(
      importAnalytics({ ...batch, sessions: [{ events: [] }] }),
      /sessions\.0\.visitor/,
    );
  });
});
