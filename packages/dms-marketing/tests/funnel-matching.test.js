const assert = require("node:assert/strict");
const test = it;
const {
  normalizeStepPath,
  stepPathMatcher,
} = require("../dist/services/funnels/step-path");
const { computeFunnelOverSessions } = require("../dist/services/funnels");
const {
  comparisonAlpha,
  liftInterval,
  twoProportionTest,
} = require("../dist/services/experiments/stats");
const { computeExperimentResults } = require("../dist/services/experiments");
const { parseFunnelSteps } = require("../dist/utils/funnel-steps-type");

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
  const [step] = parseFunnelSteps([
    { kind: "url", value: "https://shop.acme.test/Pricing/?ref=x" },
  ]);
  assert.equal(step.value, "/Pricing");
});

function event(sessionId, kind, value, at) {
  return {
    sessionId,
    kind,
    url: kind === "pageview" ? value : "/",
    name: kind === "custom" ? value : undefined,
    timestamp: new Date(at),
  };
}

test("each step counts the events it matches, so a step never sent shows", () => {
  const funnel = {
    steps: [
      { kind: "url", value: "/Pricing" },
      { kind: "custom", value: "signup" },
    ],
    conversionWindowMs: DAY,
  };
  const result = computeFunnelOverSessions(funnel, [
    [event("a", "pageview", "/pricing/", 1), event("a", "custom", "other", 2)],
    [event("b", "pageview", "/pricing", 1)],
  ]);
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
  const events = [];
  for (let i = 0; i < 400; i++) {
    const arm = i % 2 === 0 ? "control" : "bold";
    const session = `s${i}`;
    events.push({
      sessionId: session,
      kind: "exposure",
      name: "hero",
      url: "/",
      data: { variation: arm },
      timestamp: new Date(i),
    });
    if (arm === "control" ? i % 8 === 0 : i % 4 === 1) {
      events.push(event(session, "custom", "buy", i + 1));
    }
  }
  const early = computeExperimentResults(events, goal, experiment, false, DAY);
  assert.equal(early.decision.ready, false);
  const late = computeExperimentResults(
    events,
    goal,
    experiment,
    false,
    8 * DAY,
  );
  assert.equal(late.decision.ready, true);
  assert.ok(late.variations[1].upliftLow > 0);
});
