const assert = require("node:assert/strict");
const test = it;
const {
  funnelRowContext,
  funnelTablePayload,
  winnerBanner,
} = require("../dist/services/funnels-table");

function summary(overrides = {}) {
  return {
    id: "f1",
    name: "Checkout",
    kind: "funnel",
    steps: [
      { kind: "url", value: "/cart" },
      { kind: "url", value: "/checkout" },
      { kind: "url", value: "/pay" },
      { kind: "custom", value: "order" },
    ],
    windowHours: 24,
    createdAt: null,
    entered: 100,
    completed: 10,
    conversion: 10,
    deltaPoints: 2.04,
    unseenStep: null,
    experiment: null,
    ...overrides,
  };
}

const runningTest = ({ ready = true, uplift = 62, index = 1 } = {}) =>
  summary({
    id: "t1",
    name: "Hero",
    kind: "ab",
    experiment: {
      key: "hero",
      status: "running",
      variations: 3,
      since: Date.UTC(2026, 8, 18),
      until: null,
      leader: { key: "c", index, uplift, significant: true },
      exposed: 2302,
      ready,
      upliftLow: 23,
      upliftHigh: 101,
      days: 22,
    },
  });

const coverage = (period, previous) => ({
  since: Date.UTC(2026, 8, 10),
  period,
  previous,
});

test("funnel rows list every step as a pill and sign the change in points", () => {
  const { results } = funnelTablePayload([summary()], undefined);
  assert.equal(results[0].steps.length, 4);
  assert.deepEqual(results[0].steps[3], {
    label: "order",
    tone: "primary",
    variant: "outline",
  });
  assert.equal(results[0].icon, "i-ph-funnel");
  assert.equal(results[0].comparison.tone, "success");
  assert.equal(results[0].comparison.text.params.sign, "+");
  assert.equal(results[0].status, null);
});

test("no comparison draws no line rather than a 'New' badge", () => {
  const { results } = funnelTablePayload(
    [summary({ deltaPoints: null })],
    undefined,
  );
  assert.equal(results[0].comparison, null);
});

test("a step never received replaces the detail with a warning", () => {
  const { results } = funnelTablePayload(
    [summary({ unseenStep: "order" })],
    undefined,
  );
  assert.equal(results[0].detail.tone, "warning");
  assert.equal(results[0].detail.text.params.step, "order");
});

test("the leader is named by its own letter, and only when ahead", () => {
  const ahead = funnelTablePayload([runningTest({ index: 2 })], undefined);
  assert.equal(ahead.results[0].detail.text.params.letter, "C");
  const behind = funnelTablePayload([runningTest({ uplift: -12 })], undefined);
  assert.match(behind.results[0].detail.text.key, /control_leads$/);
});

test("a kind filter narrows the table to funnels or tests", () => {
  const rows = [summary(), runningTest()];
  assert.equal(funnelTablePayload(rows, "ab").total, 1);
  assert.equal(funnelTablePayload(rows, "funnel").results[0]._id, "f1");
});

test("each row carries the context its actions link with", () => {
  const context = { website: "w1", from: "2026-10-01", to: "2026-10-11" };
  const { results } = funnelTablePayload([summary()], undefined, context);
  assert.deepEqual(results[0].context, context);
});

test("the row context names a preset, or a custom range's bounds", () => {
  const scope = {
    from: "2026-09-11T22:00:00.000Z",
    to: "2026-10-11T21:59:59.999Z",
    comparison: "previous-year",
  };
  assert.deepEqual(
    funnelRowContext({ ...scope, preset: "last-30-days" }, "w1"),
    {
      website: "w1",
      period: "last-30-days",
      from: "",
      to: "",
      compare: "previous-year",
    },
  );
  assert.deepEqual(funnelRowContext({ ...scope, preset: "custom" }, "w1"), {
    website: "w1",
    period: "",
    from: "2026-09-12",
    to: "2026-10-11",
    compare: "previous-year",
  });
});

test("only a test ready to decide gets the winner banner", () => {
  assert.equal(winnerBanner([summary(), runningTest({ ready: false })]), null);
  const banner = winnerBanner([runningTest()]);
  assert.equal(banner.tone, "success");
  assert.equal(banner.actions[0].to, "/modules/marketing/funnel?id=t1");
});

test("days raw events miss come before the winner; a missing comparison after", () => {
  assert.equal(
    winnerBanner([runningTest()], coverage(true, true)).tone,
    "info",
  );
  assert.equal(
    winnerBanner([runningTest()], coverage(false, true)).tone,
    "success",
  );
  assert.equal(winnerBanner([summary()], coverage(false, true)).tone, "info");
  assert.equal(winnerBanner([summary()], coverage(false, false)), null);
});
