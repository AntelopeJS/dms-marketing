const assert = require("node:assert/strict");
const test = it;
const { editedExperiment } = require("../dist/data-api/funnels");

const SITE = "site-a";
const OTHER_SITE = "site-b";
const LOCKED_MESSAGE = "$page.marketing.errors.experiment_locked";

function storedExperiment(status, runs = []) {
  return {
    key: "hero",
    status,
    variations: [
      { key: "control", weight: 1 },
      { key: "bold", weight: 1 },
    ],
    runs,
  };
}

function funnel(experiment) {
  return { _id: "funnel-1", websiteId: SITE, name: "Signup", experiment };
}

function isLocked(error) {
  return (
    error.getStatus() === 400 && error.getBody().toString() === LOCKED_MESSAGE
  );
}

test("an edit without experiment keeps a running split and its runs", () => {
  const stored = storedExperiment("running", [
    { startedAt: 1_000, stoppedAt: 2_000 },
    { startedAt: 3_000, stoppedAt: null },
  ]);
  assert.deepEqual(
    editedExperiment({ name: "Renamed" }, funnel(stored), SITE),
    stored,
  );
});

test("an edit without experiment keeps a draft, even on another site", () => {
  const stored = storedExperiment("draft");
  assert.deepEqual(
    editedExperiment({ websiteId: OTHER_SITE }, funnel(stored), OTHER_SITE),
    stored,
  );
});

test("an edit without experiment leaves a plain funnel plain", () => {
  assert.equal(editedExperiment({ name: "Renamed" }, funnel(null), SITE), null);
  assert.equal(
    editedExperiment({ name: "Renamed" }, funnel(undefined), SITE),
    null,
  );
});

test("an edit without experiment still cannot move a running split", () => {
  const stored = storedExperiment("running", [
    { startedAt: 1_000, stoppedAt: null },
  ]);
  assert.throws(
    () =>
      editedExperiment({ websiteId: OTHER_SITE }, funnel(stored), OTHER_SITE),
    isLocked,
  );
});

test("an explicit null experiment still clears a draft", () => {
  assert.equal(
    editedExperiment(
      { experiment: null },
      funnel(storedExperiment("draft")),
      SITE,
    ),
    null,
  );
});
