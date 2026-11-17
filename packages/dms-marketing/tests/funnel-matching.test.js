const assert = require("node:assert/strict");
const test = it;
const {
  normalizeStepPath,
  stepPathMatcher,
} = require("../dist/services/funnels/step-path");
const { FunnelTally } = require("../dist/services/funnels");
const {
  comparisonAlpha,
  liftInterval,
  twoProportionTest,
} = require("../dist/services/experiments/stats");
const { ExperimentTally } = require("../dist/services/experiments");
const { funnelStepsSchema } = require("../dist/utils/funnel-steps-type");

const DAY = 86_400_000;

test("a pasted URL, query string or trailing slash comes down to the path", () => {
  for (const pasted of [
    "https://shop.acme.test/sale/office-chairs?utm_source=x",
    "shop.acme.test/sale/office-chairs/",
    "/sale/office-chairs#reviews",
    "sale/office-chairs",
  ]) {
    assert.equal(normalizeStepPath(pasted), "/sale/office-chairs");
  }
  assert.equal(normalizeStepPath("/"), "/");
  assert.equal(normalizeStepPath("https://shop.acme.test"), "/");
  assert.equal(normalizeStepPath("/blog/*"), "/blog/*");
});

test("page steps match whatever the case, and a final * as a prefix", () => {
  assert.ok(stepPathMatcher("/Sale/Office-Chairs/")("/sale/office-chairs"));
  assert.ok(stepPathMatcher("/blog/*")("/blog/a-post"));
  assert.ok(!stepPathMatcher("/blog/*")("/blogging"));
  assert.ok(!stepPathMatcher("/sale")("/sale/office-chairs"));
});

test("saved page steps are stored as the path", () => {
  const [step] = funnelStepsSchema.parse([
    { kind: "url", value: "https://shop.acme.test/Pricing/?ref=x" },
  ]);
  assert.equal(step.value, "/Pricing");
});

/**
 * @param {"pageview" | "custom"} kind
 * @param {string} value
 * @param {number} at
 * @returns {import("../dist/db").TrailEvent}
 */
function event(kind, value, at) {
  return kind === "pageview"
    ? { kind, at, path: value }
    : { kind, at, name: value };
}

test("each step counts the events it matches, so a step never sent shows", () => {
  const funnel = {
    steps: [
      { kind: "url", value: "/Pricing" },
      { kind: "custom", value: "signup" },
    ],
    conversionWindowMs: DAY,
  };
  const tally = new FunnelTally(funnel);
  tally.add([event("pageview", "/pricing/", 1), event("custom", "other", 2)]);
  tally.add([event("pageview", "/pricing", 1)]);
  const result = tally.result();
  assert.equal(result.events, 3);
  assert.deepEqual(
    result.steps.map((step) => [step.sessions, step.matches]),
    [
      [2, 2],
      [0, 0],
    ],
  );
});

test("the lift interval brackets the lift and excludes 0 when significant", () => {
  const test = twoProportionTest(62, 1171, 97, 1131);
  assert.ok(test.significant);
  const interval = liftInterval(62, 1171, 97, 1131);
  const lift = 97 / 1131 / (62 / 1171) - 1;
  assert.ok(interval.low > 0 && interval.low < lift && lift < interval.high);
  assert.equal(liftInterval(2, 100, 3, 100), null);
});

test("past two arms each challenger is tested at a stricter level", () => {
  assert.equal(comparisonAlpha(2), 0.05);
  assert.equal(comparisonAlpha(3), 0.025);
});

test("a verdict is ready only past a week and the conversions floor", () => {
  const experiment = {
    key: "hero",
    status: "running",
    variations: [
      { key: "control", weight: 1 },
      { key: "bold", weight: 1 },
    ],
    runs: [],
  };
  const goal = {
    steps: [{ kind: "custom", value: "buy" }],
    conversionWindowMs: DAY,
  };
  const tally = new ExperimentTally(goal, experiment);
  for (let i = 0; i < 400; i++) {
    const arm = i % 2 === 0 ? "control" : "bold";
    /** @type {import("../dist/db").TrailEvent[]} */
    const session = [
      { kind: "exposure", at: i, experiment: "hero", variation: arm },
    ];
    if (arm === "control" ? i % 8 === 0 : i % 4 === 1) {
      session.push(event("custom", "buy", i + 1));
    }
    tally.add(session);
  }
  const early = tally.result(false, DAY);
  assert.equal(early.decision.ready, false);
  const late = tally.result(false, 8 * DAY);
  assert.equal(late.decision.ready, true);
  assert.ok(late.variations[1].upliftLow > 0);
});
