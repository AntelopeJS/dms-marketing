const assert = require("node:assert/strict");
const test = it;
const { kpiPayload, qualityItems } = require("../dist/services/dashboard");
const { deltaText } = require("../dist/services/composed");

const DAY = 86_400_000;
const FIRST = Date.UTC(2026, 8, 1);

function row(dayIndex, sessions) {
  return {
    day: FIRST + dayIndex * DAY,
    pageviews: sessions * 3,
    sessions,
    newVisitors: sessions,
    customEvents: 0,
    bouncedSessions: 0,
    sessionDurationMs: 0,
    tops: {},
  };
}

function window(days, offset = 0, inProgress = false) {
  const firstDay = FIRST + offset * DAY;
  return {
    firstDay,
    lastDay: firstDay + (days - 1) * DAY,
    days,
    since: new Date(firstDay),
    until: new Date(firstDay + days * DAY - 1),
    inProgress,
    localOffset: 0,
  };
}

test("the trend line leaves out the day still being counted", () => {
  const read = {
    window: window(3, 0, true),
    rows: [row(0, 10), row(1, 12), row(2, 1)],
    compare: null,
    compareRows: [],
    compareDays: [],
  };
  const payload = kpiPayload(read, "sessions");
  assert.equal(payload.value, 23);
  assert.deepEqual(payload.sparkline, [10, 12]);
  assert.equal(payload.delta, undefined);
});

test("a single day draws no trend line", () => {
  const read = {
    window: window(1, 0, true),
    rows: [row(0, 4)],
    compare: null,
    compareRows: [],
    compareDays: [],
  };
  assert.deepEqual(kpiPayload(read, "sessions").sparkline, []);
});

test("the previous value is a whole number, the change uses the exact one", () => {
  const read = {
    window: window(1, 0, true),
    rows: [row(0, 5)],
    compare: window(1, -1),
    compareRows: [row(-1, 4.4)],
    compareDays: [row(-1, 10)],
  };
  const payload = kpiPayload(read, "sessions");
  assert.equal(payload.previousValue, 4);
  assert.ok(Math.abs(payload.delta - (5 / 4.4 - 1) * 100) < 1e-9);
});

test("a change names the period it is measured against", () => {
  assert.equal(deltaText(1, "number").key, "$page.marketing.compose.delta");
  assert.equal(
    deltaText(1, "number", "previous-year").key,
    "$page.marketing.compose.delta_previous_year",
  );
  const read = {
    window: window(1),
    rows: [row(0, 10)],
    compare: window(1, -365),
    compareRows: [row(-365, 8)],
    compareDays: [row(-365, 8)],
  };
  const [bounce] = qualityItems(read, "previous-year");
  assert.equal(
    bounce.detail.key,
    "$page.marketing.compose.delta_previous_year",
  );
});
