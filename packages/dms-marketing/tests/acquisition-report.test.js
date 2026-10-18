const assert = require("node:assert/strict");
const test = it;
const {
  campaignKey,
  resolveChannel,
  splitCampaignKey,
} = require("../dist/services/acquisition");
const {
  campaignNotice,
  campaignsReport,
  campaignTablePayload,
  channelsPayload,
} = require("../dist/services/acquisition-report");
const {
  extractReferrerDomain,
  parseTrackedUrl,
} = require("../dist/services/url");
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
  const { items, total, compared } = channelsPayload(read);
  assert.equal(total, 10);
  // No comparison window: the card leaves the change column out.
  assert.equal(compared, false);
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
  const sale = ["newsletter", "email", "autumn-sale", "email"].join(SEPARATOR);
  const untagged = ["newsletter", "", "", "direct"].join(SEPARATOR);
  const read = {
    window: window(2),
    rows: [
      row(0, {
        sessions: 20,
        tops: { topCampaigns: { [sale]: 5, [untagged]: 1 } },
      }),
      row(1, { sessions: 20, tops: { topCampaigns: { [sale]: 3 } } }),
    ],
  };
  const report = campaignsReport(read);
  const [first, second] = report.rows;
  assert.equal(first.campaign, "autumn-sale");
  assert.equal(first.channel, "email");
  assert.deepEqual(first.daily, [5, 3]);
  assert.equal(second.missingMedium, true);

  const all = { offset: 0, limit: 25 };
  const email = campaignTablePayload(report, { ...all, channel: "is:email" });
  assert.equal(email.total, 1);
  assert.equal(email.results[0]._id, sale);
  assert.equal(email.results[0].medium, "email");
  assert.equal(campaignTablePayload(report, all).total, 2);
  assert.equal(
    campaignTablePayload(report, { ...all, search: "AUTUMN" }).total,
    1,
  );
  assert.equal(campaignNotice(report, "missing").tone, "warning");
  assert.deepEqual(campaignNotice(report, "tagged").title.params.count, {
    type: "count",
    value: 9,
  });
});

test("the campaign key keeps the channel the session was counted under", () => {
  const key = campaignKey({
    utmSource: "facebook",
    utmCampaign: "launch",
    referrerDomain: "facebook.com",
  });
  assert.deepEqual(splitCampaignKey(key), {
    source: "facebook",
    medium: undefined,
    campaign: "launch",
    channel: "social",
  });
  const paid = campaignKey({
    utmSource: "news",
    utmMedium: "email",
    clickIdParam: "gclid",
  });
  assert.equal(splitCampaignKey(paid).channel, "paid");
  assert.equal(campaignKey({ referrerDomain: "google.com" }), undefined);
});

test("a campaign key without its channel is left out, values read as stored", () => {
  const keys = {
    [["qa-mail", "email", "X"].join(SEPARATOR)]: 2,
    [["qa-mail", "email", "X", "email"].join(SEPARATOR)]: 4,
    [["qa-mail", "Email", "X", "email"].join(SEPARATOR)]: 1,
  };
  assert.equal(
    splitCampaignKey(["qa-mail", "email", "X"].join(SEPARATOR)),
    undefined,
  );
  const report = campaignsReport({
    window: window(1),
    rows: [row(0, { sessions: 20, tops: { topCampaigns: keys } })],
  });
  assert.deepEqual(
    report.rows.map((entry) => [entry.medium, entry.channel, entry.sessions]),
    [
      ["email", "email", 4],
      ["Email", "email", 1],
    ],
  );
});

test("tabs and filters narrow every row before the page is cut", () => {
  const topCampaigns = {};
  for (let index = 0; index < 120; index++) {
    topCampaigns[["g", "cpc", `c${index}`, "paid"].join(SEPARATOR)] = 10;
  }
  for (let index = 0; index < 5; index++) {
    topCampaigns[["n", "email", `e${index}`, "email"].join(SEPARATOR)] = 1;
  }
  const report = campaignsReport({
    window: window(1),
    rows: [row(0, { sessions: 2000, tops: { topCampaigns } })],
  });
  const page = { offset: 0, limit: 25 };
  assert.equal(campaignTablePayload(report, page).total, 125);
  assert.equal(campaignTablePayload(report, page).results.length, 25);
  const email = campaignTablePayload(report, { ...page, channel: "is:email" });
  assert.equal(email.total, 5);
  assert.equal(email.results.length, 5);
  assert.equal(
    campaignTablePayload(report, { ...page, channel: "is_not:paid" }).total,
    5,
  );
  assert.equal(
    campaignTablePayload(report, { ...page, channel: "is_empty:" }).total,
    0,
  );
  assert.equal(
    campaignTablePayload(report, { ...page, channel: "is_not_empty:" }).total,
    125,
  );
  const sorted = campaignTablePayload(report, {
    ...page,
    channel: "is:email",
    sortKey: "campaign",
    sortDirection: "desc",
  });
  assert.equal(sorted.results[0].campaign, "e4");
  // A tab counter asks for one row and reads the total.
  assert.equal(
    campaignTablePayload(report, { offset: 0, limit: 1, channel: "is:email" })
      .total,
    5,
  );
});

test("comparison days whose top maps were emptied give no channel delta", () => {
  const read = {
    window: window(1),
    rows: [row(0, { sessions: 10, tops: { topChannels: { direct: 10 } } })],
    compare: window(1, -1),
    compareRows: [row(-1, { sessions: 8, tops: {} })],
  };
  const payload = channelsPayload(read);
  assert.equal(payload.compareUnavailable, true);
  assert.equal(payload.compared, true);
  assert.ok(payload.items.every((item) => item.delta === null));
});

test("UTM values are trimmed, source and medium lower-cased", () => {
  const { utm } = parseTrackedUrl(
    "/?utm_source=%20News%20&utm_medium=Email%20&utm_campaign=%20Black-Friday",
  );
  assert.deepEqual(utm, {
    source: "news",
    medium: "email",
    campaign: "Black-Friday",
  });
});

test("link-shim and mobile hosts collapse onto their network", () => {
  const own = new Set(["shop.example"]);
  assert.equal(
    extractReferrerDomain("https://l.facebook.com/l.php?u=x", own),
    "facebook.com",
  );
  assert.equal(
    extractReferrerDomain("https://m.youtube.com/watch", own),
    "youtube.com",
  );
  assert.equal(extractReferrerDomain("https://t.co/abc", own), "t.co");
  assert.equal(
    extractReferrerDomain("https://m.shop.example/", own),
    undefined,
  );
});
