const assert = require("node:assert/strict");
const test = it;
const {
  funnelTablePayload,
  winnerBanner,
} = require("../dist/services/funnels-table");
const { GetMetadata } = require("@antelopejs/interface-core");
const { PageMetadata } = require("@antelopejs/interface-dms/page");
const { CONTEXT_QUERY } = require("../dist/pages/blocks");
const { MarketingFunnelPage } = require("../dist/pages/funnel/page");

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

test("a row's links name the page's website and period as page tokens", () => {
  assert.equal(
    CONTEXT_QUERY,
    [
      "website={{query.website}}",
      "marketing.period={{query.marketing.period}}",
      "marketing.compare={{query.marketing.compare}}",
      "marketing.from={{query.marketing.from}}",
      "marketing.to={{query.marketing.to}}",
      "marketing.compareFrom={{query.marketing.compareFrom}}",
      "marketing.compareTo={{query.marketing.compareTo}}",
    ].join("&"),
  );
  const { results } = funnelTablePayload([summary()], undefined);
  assert.equal("context" in results[0], false);
});

test("a funnel page opened without an id goes back to the list in context", () => {
  const { validation } = GetMetadata(
    MarketingFunnelPage,
    PageMetadata,
  ).pageInfo;
  assert.deepEqual(validation, {
    requiredQueryParams: ["id"],
    redirectTo: `/modules/marketing/funnels?${CONTEXT_QUERY}`,
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
