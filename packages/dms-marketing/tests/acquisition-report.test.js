const assert = require("node:assert/strict");
const test = it;
const { resolveChannel } = require("../dist/services/acquisition");
const {
  campaignNotice,
  campaignsPayload,
  campaignTablePayload,
  channelsPayload,
} = require("../dist/services/acquisition-report");
const { kpiPayload, qualityItems } = require("../dist/services/dashboard");

const SEPARATOR = "\u001f";
const DAY = 86_400_000;
const FIRST = Date.UTC(2026, 8, 1);

function row(dayIndex, overrides = {}) {
  return {
    day: FIRST + dayIndex * DAY,
    pageviews: 30,
    sessions: 10,
    newVisitors: 6,
    customEvents: 2,
    bouncedSessions: 4,
    sessionDurationMs: 10 * 120_000,
    tops: {},
    ...overrides,
  };
}

function window(days, offset = 0) {
  const firstDay = FIRST + offset * DAY;
  return {
    firstDay,
    lastDay: firstDay + (days - 1) * DAY,
    days,
    since: new Date(firstDay),
    until: new Date(firstDay + days * DAY - 1),
  };
}

test("newsletter and email mediums land in Email, before the referrer rules", () => {
  assert.equal(resolveChannel(undefined, "newsletter"), "email");
  assert.equal(resolveChannel("mail.google.com", "Email"), "email");
  assert.equal(resolveChannel("google.com", "cpc"), "paid");
  assert.equal(resolveChannel(undefined, undefined), "direct");
  assert.equal(resolveChannel(undefined, "referral"), "referral");
});

test("the KPI payload compares with the comparison window", () => {
  const read = {
    window: window(2),
    rows: [row(0), row(1, { sessions: 30 })],
    compare: window(2, -2),
    compareRows: [row(-2, { sessions: 10 }), row(-1, { sessions: 10 })],
  };
  const payload = kpiPayload(read, "sessions");
  assert.equal(payload.value, 40);
  assert.equal(payload.previousValue, 20);
  assert.equal(payload.delta, 100);
  assert.deepEqual(payload.sparkline, [10, 30]);
});

test("a zero previous value gives no delta rather than an infinite one", () => {
  const read = {
    window: window(1),
    rows: [row(0)],
    compare: window(1, -1),
    compareRows: [],
  };
  assert.equal(kpiPayload(read, "sessions").delta, undefined);
});

test("session quality composes bounce in points, a drop reading as good", () => {
  const read = {
    window: window(1),
    rows: [row(0, { bouncedSessions: 5 })],
    compare: window(1, -1),
    compareRows: [row(-1, { bouncedSessions: 4 })],
  };
  const [bounce, duration, pages] = qualityItems(read);
  assert.deepEqual(bounce.value, {
    key: "$page.marketing.compose.percent",
    params: { value: { type: "number", value: 50 } },
  });
  assert.deepEqual(bounce.detail, {
    key: "$page.marketing.compose.delta",
    params: {
      sign: "+",
      value: {
        key: "$page.marketing.compose.points",
        params: { value: { type: "number", value: 10 } },
      },
    },
  });
  assert.equal(bounce.detailTone, "error");
  assert.deepEqual(duration.value, {
    key: "$page.marketing.compose.duration_minutes",
    params: { minutes: 2, seconds: 0 },
  });
  assert.equal(pages.value, 3);
});

test("every channel is listed, sorted by sessions, with its share", () => {
  const read = {
    window: window(1),
    rows: [
      row(0, { sessions: 10, tops: { topChannels: { direct: 6, email: 4 } } }),
    ],
    compare: null,
    compareRows: [],
  };
  const { items, total } = channelsPayload(read);
  assert.equal(total, 10);
  assert.equal(items.length, 6);
  assert.deepEqual(
    items.slice(0, 2).map((item) => [item.id, item.share]),
    [
      ["direct", 60],
      ["email", 40],
    ],
  );
  assert.equal(items[0].delta, null);
});

test("campaign rows carry their channel, daily sessions and the missing medium flag", () => {
  const sale = ["newsletter", "email", "autumn-sale"].join(SEPARATOR);
  const untagged = ["newsletter", "", ""].join(SEPARATOR);
  const read = {
    window: window(2),
    rows: [
      row(0, {
        sessions: 20,
        tops: { topCampaigns: { [sale]: 5, [untagged]: 1 } },
      }),
      row(1, { sessions: 20, tops: { topCampaigns: { [sale]: 3 } } }),
    ],
    compare: null,
    compareRows: [],
  };
  const payload = campaignsPayload(read, undefined);
  assert.equal(payload.taggedSessions, 9);
  assert.equal(payload.missingMediumSessions, 1);
  const [first, second] = payload.rows;
  assert.equal(first.campaign, "autumn-sale");
  assert.equal(first.channel, "email");
  assert.deepEqual(first.daily, [5, 3]);
  assert.equal(second.missingMedium, true);
  assert.equal(campaignsPayload(read, "AUTUMN").rows.length, 1);

  const table = campaignTablePayload(payload, "email");
  assert.equal(table.total, 1);
  assert.equal(table.results[0]._id, sale);
  assert.equal(table.results[0].medium, "email");
  assert.equal(campaignTablePayload(payload, undefined).total, 2);
  assert.equal(campaignNotice(payload, "missing").tone, "warning");
  assert.equal(campaignNotice(payload, "truncated"), null);
});
