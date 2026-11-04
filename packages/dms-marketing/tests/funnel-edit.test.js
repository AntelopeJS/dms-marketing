const assert = require("node:assert/strict");
const test = it;
const { editedExperiment } = require("../dist/data-api/funnels");

const SITE = "site-a";
const OTHER_SITE = "site-b";
const LOCKED_MESSAGE = "$page.marketing.errors.experiment_locked";

/** @typedef {import("../dist/db/tables/funnels.table").FunnelExperiment} FunnelExperiment */

/**
 * @param {FunnelExperiment["status"]} status
 * @param {FunnelExperiment["runs"]} [runs]
 */
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

/** @param {FunnelExperiment | null | undefined} experiment */
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

const INVALID_BODY = "$page.marketing.errors.invalid_body";

function isInvalidBody(error) {
  return (
    error.getStatus() === 400 && error.getBody().toString() === INVALID_BODY
  );
}

test("a write body is the JSON object sent, keys in the order sent", () => {
  const text = '{"name":"Signup","steps":[{"kind":"url","value":"/a"}],"a":1}';
  assert.equal(
    JSON.stringify(require("../dist/data-api/body").parseBody(text)),
    text,
  );
  assert.equal(
    JSON.stringify(
      require("../dist/data-api/body").parseBody(Buffer.from(text)),
    ),
    text,
  );
});

test("a write body that is not a JSON object is a 400, not a server error", () => {
  for (const body of ["{not json", "", "null", "[]", "5", '"x"', "true"]) {
    assert.throws(
      () => {
        require("../dist/data-api/body").parseBody(body);
      },
      isInvalidBody,
      body,
    );
  }
});

test("only data JSON can carry is a JSON value", () => {
  const loop = { a: [] };
  loop.a.push(loop);
  const shared = { n: 1 };
  const cases = [
    [{ a: [1, "b", null, true, { c: {} }] }, true],
    [{ x: shared, y: shared }, true],
    [JSON.parse(`${"[".repeat(200_000)}${"]".repeat(200_000)}`), true],
    [undefined, false],
    [{ a: undefined }, false],
    [{ at: new Date() }, false],
    [{ m: new Map() }, false],
    [[() => 1], false],
    [new (class Row {})(), false],
    [loop, false],
  ];
  for (const [value, expected] of cases) {
    assert.equal(require("../dist/utils/guards").isJsonValue(value), expected);
  }
  assert.equal(require("../dist/utils/guards").isJsonObject([]), false);
  assert.equal(require("../dist/utils/guards").isJsonObject(null), false);
});
