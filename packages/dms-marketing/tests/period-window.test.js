const assert = require("node:assert/strict");
const test = it;
const {
  comparisonKindOf,
  elapsedShare,
  previousWindow,
  resolveCompareWindow,
  resolveQueryWindow,
  trailingWindow,
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

test("a trailing window ends today", () => {
  const window = trailingWindow(30);
  const now = new Date();
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  assert.equal(window.lastDay, today);
  assert.equal(window.days, 30);
  assert.equal(windowDays(window).length, 30);
});

test("a read without bounds covers the last 7 days, a legacy Nd ignored", () => {
  const window = resolveQueryWindow({ period: "30d" });
  assert.deepEqual(
    [window.firstDay, window.lastDay, window.days],
    [trailingWindow(7).firstDay, trailingWindow(7).lastDay, 7],
  );
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

function utcDay(offsetDays) {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) +
      offsetDays * DAY,
  )
    .toISOString()
    .slice(0, 10);
}

const start = (day) => `${day}T00:00:00.000Z`;
const end = (day) => `${day}T23:59:59.999Z`;

test("a window ending on a UTC day not begun yet ends on the current one", () => {
  // Past local midnight east of UTC, "today" names tomorrow's UTC date.
  const window = resolveQueryWindow({
    from: start(utcDay(-6)),
    to: end(utcDay(1)),
  });
  assert.equal(window.lastDay, utcMidnight(utcDay(0)));
  assert.equal(window.days, 8);
  assert.equal(window.inProgress, true);
  const previous = resolveCompareWindow({
    from: start(utcDay(-6)),
    to: end(utcDay(1)),
    compareFrom: start(utcDay(-14)),
    compareTo: end(utcDay(-7)),
  });
  assert.equal(previous.lastDay, window.firstDay - DAY);
});

test("a window over past days is not in progress and compares whole days", () => {
  const window = resolveQueryWindow({
    from: start("2026-09-08"),
    to: end("2026-09-14"),
  });
  assert.equal(window.inProgress, false);
  assert.equal(elapsedShare(window), 1);
  const today = resolveQueryWindow({
    from: start(utcDay(0)),
    to: end(utcDay(0)),
  });
  const share = elapsedShare(today);
  assert.ok(share > 0 && share <= 1);
});

test("the reader's midnight is read off the bound the period scope sent", () => {
  const window = resolveQueryWindow({
    from: "2026-09-07T22:00:00.000Z",
    to: "2026-09-14T21:59:59.999Z",
  });
  assert.equal(window.localOffset, 2 * 60 * 60 * 1000);
  assert.equal(previousWindow(window).localOffset, window.localOffset);
  assert.equal(
    resolveQueryWindow({ from: start("2026-09-08"), to: end("2026-09-14") })
      .localOffset,
    0,
  );
});

test("no comparison bounds, no comparison window", () => {
  assert.equal(
    resolveCompareWindow({ from: start("2026-09-08"), to: end("2026-09-14") }),
    null,
  );
});

test("the comparison is named after what the read asked for", () => {
  assert.equal(
    comparisonKindOf({ comparison: "previous-year" }),
    "previous-year",
  );
  assert.equal(
    comparisonKindOf({ comparison: "previous-period" }),
    "previous-period",
  );
  assert.equal(comparisonKindOf({}), "previous-period");
});
