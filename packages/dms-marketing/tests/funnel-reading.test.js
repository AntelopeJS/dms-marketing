const assert = require("node:assert/strict");
const test = it;
const { unseenStepOf } = require("../dist/services/funnel-report");

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

test("a step never received is only concluded from a complete read", () => {
  const results = {
    computation: computation([10, 0, 0]),
    truncated: false,
    window: { since: 0, until: 1 },
  };
  assert.equal(unseenStepOf(results), "/step-1");
  assert.equal(unseenStepOf({ ...results, truncated: true }), null);
});
