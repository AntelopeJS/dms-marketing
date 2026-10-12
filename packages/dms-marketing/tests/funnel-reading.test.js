const assert = require("node:assert/strict");
const test = it;
const {
  experimentVerdict,
  unseenStepOf,
} = require("../dist/services/funnel-report");

function computation(matches) {
  return {
    totalSessions: 10,
    events: 40,
    steps: matches.map((count, index) => ({
      step: { kind: "url", value: `/step-${index}` },
      sessions: count > 0 ? 5 : 0,
      conversionRate: 0,
      matches: count,
    })),
  };
}

function arm(key, conversionRate, test = {}) {
  return {
    key,
    exposedSessions: 1000,
    computation: computation([1]),
    conversionRate,
    conversions: conversionRate * 1000,
    uplift: null,
    upliftLow: null,
    upliftHigh: null,
    pValue: null,
    significant: null,
    ...test,
  };
}

/** Control at 10 %, B at 12 % (significant), C at 11 % (not). */
function split({ ready = true, mismatch = false, truncated = false } = {}) {
  const scored = (uplift, significant) => ({
    uplift,
    pValue: significant ? 0.01 : 0.4,
    significant,
  });
  return {
    computation: computation([10, 3]),
    truncated,
    window: { since: 0, until: 1 },
    experiment: {
      control: "a",
      alpha: 0.025,
      variations: [
        arm("a", 0.1),
        arm("b", 0.12, scored(0.2, true)),
        arm("c", 0.11, scored(0.1, false)),
      ],
      srm: { expected: [], observed: [], pValue: 0.5, mismatch },
      decision: { days: ready ? 9 : 3, minDays: 7, minConversions: 30, ready },
    },
  };
}

test("a step never received is only concluded from a complete read", () => {
  const results = {
    computation: computation([10, 0, 0]),
    truncated: false,
    window: { since: 0, until: 1 },
  };
  assert.equal(unseenStepOf(results), "/step-1");
  assert.equal(unseenStepOf({ ...results, truncated: true }), null);
});

test("a significant leader short of the decision rule is too early, not a winner", () => {
  assert.deepEqual(experimentVerdict(split()), { kind: "winner", leader: 1 });
  assert.deepEqual(experimentVerdict(split({ ready: false })), {
    kind: "early",
    leader: 1,
  });
});

test("a warning withholds the verdict, and a plain funnel has none", () => {
  assert.equal(experimentVerdict(split({ mismatch: true })).kind, "withheld");
  const truncated = split({ truncated: true });
  for (const variation of truncated.experiment.variations) {
    Object.assign(variation, { pValue: null, significant: null });
  }
  assert.deepEqual(experimentVerdict(truncated), {
    kind: "withheld",
    leader: null,
  });
  assert.equal(experimentVerdict({ ...split(), experiment: undefined }), null);
});

test("the leader is the best scored challenger, even behind the control", () => {
  const results = split();
  const [, b, c] = results.experiment.variations;
  Object.assign(b, { conversionRate: 0.08, uplift: -0.2 });
  Object.assign(c, { conversionRate: 0.09, uplift: -0.1, significant: true });
  assert.deepEqual(experimentVerdict(results), { kind: "loser", leader: 2 });
  Object.assign(c, { significant: false });
  assert.deepEqual(experimentVerdict(results), { kind: "flat", leader: 2 });
});
