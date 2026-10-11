const assert = require("node:assert/strict");
const test = it;
const {
  previousWindow,
  resolveCompareWindow,
  resolveQueryWindow,
  windowDays,
} = require("../dist/services/period");

const DAY = 86_400_000;

function utcMidnight(iso) {
  return Date.parse(`${iso}T00:00:00.000Z`);
}

test("local day bounds east of UTC map on the same calendar days", () => {
  // Sep 8 00:00 → Oct 7 23:59:59.999 in UTC+2
  const window = resolveQueryWindow({
    from: "2026-09-07T22:00:00.000Z",
    to: "2026-10-07T21:59:59.999Z",
  });
  assert.equal(window.firstDay, utcMidnight("2026-09-08"));
  assert.equal(window.lastDay, utcMidnight("2026-10-07"));
  assert.equal(window.days, 30);
});

test("local day bounds west of UTC map on the same calendar days", () => {
  // Sep 8 00:00 → Sep 14 23:59:59.999 in UTC-5
  const window = resolveQueryWindow({
    from: "2026-09-08T05:00:00.000Z",
    to: "2026-09-15T04:59:59.999Z",
  });
  assert.equal(window.firstDay, utcMidnight("2026-09-08"));
  assert.equal(window.lastDay, utcMidnight("2026-09-14"));
  assert.equal(window.days, 7);
});

test("a window longer than the cap keeps its most recent days", () => {
  const window = resolveQueryWindow({
    from: "2026-01-01T00:00:00.000Z",
    to: "2026-09-30T23:59:59.999Z",
  });
  assert.equal(window.days, 90);
  assert.equal(window.lastDay, utcMidnight("2026-09-30"));
});

test("the legacy Nd parameter still ends today", () => {
  const window = resolveQueryWindow({ period: "7d" });
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  assert.equal(window.lastDay, today);
  assert.equal(window.days, 7);
  assert.equal(windowDays(window).length, 7);
});

test("no comparison bounds means no comparison window", () => {
  assert.equal(resolveCompareWindow({}), null);
  assert.equal(
    resolveCompareWindow({ compareFrom: "nonsense", compareTo: "2026-09-01" }),
    null,
  );
});

test("the previous window has the same length and ends the day before", () => {
  const window = resolveQueryWindow({
    from: "2026-09-08T00:00:00.000Z",
    to: "2026-09-14T23:59:59.999Z",
  });
  const previous = previousWindow(window);
  assert.equal(previous.days, window.days);
  assert.equal(previous.lastDay, window.firstDay - DAY);
});
