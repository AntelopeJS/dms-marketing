const assert = require("node:assert/strict");
const test = it;
const {
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
    experiment: null,
    ...overrides,
  };
}

const runningTest = (significant) =>
  summary({
    id: "t1",
    name: "Hero",
    kind: "ab",
    experiment: {
      key: "hero",
      status: "running",
      variations: 2,
      since: Date.UTC(2026, 8, 18),
      until: null,
      leader: { key: "b", uplift: 62, significant, confidence: 99.8 },
      exposed: 2302,
    },
  });

test("funnel rows shorten long step lists and sign the change in points", () => {
  const { results } = funnelTablePayload([summary()], undefined);
  assert.equal(results[0].steps, "/cart → +2 → order");
  assert.equal(results[0].comparison.tone, "success");
  assert.equal(results[0].comparison.text.params.sign, "+");
  assert.equal(results[0].status, null);
});

test("a kind filter narrows the table to funnels or tests", () => {
  const rows = [summary(), runningTest(true)];
  assert.equal(funnelTablePayload(rows, "ab").total, 1);
  assert.equal(funnelTablePayload(rows, "funnel").results[0]._id, "f1");
});

test("only a significant running test with its leader ahead gets the banner", () => {
  assert.equal(winnerBanner([summary(), runningTest(false)]), null);
  const banner = winnerBanner([runningTest(true)]);
  assert.equal(banner.tone, "success");
  assert.equal(banner.actions[0].to, "/modules/marketing/funnel?id=t1");
});
