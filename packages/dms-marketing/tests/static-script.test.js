const assert = require("node:assert/strict");
const test = it;
const { staticScript } = require("../dist/services/static-script");

/**
 * The section headers each served script is cut at, in the order the script
 * runs them: a part joined out of order or left out breaks this list.
 */
/** @type {Record<"tracker" | "snapshot", string[]>} */
const SECTIONS = {
  tracker: [
    "// --- Public API",
    "// --- Configuration",
    "// --- Excluded pages",
    "// --- Pageviews",
    "// --- Scroll root",
    "// --- Scroll depth",
    "// --- Click capture",
    "// --- Page snapshots",
    "// --- Experiments",
    "// --- Lifecycle",
  ],
  snapshot: [
    "// --- Text",
    "// --- URLs",
    "// --- Stylesheets",
    "// --- Elements",
    "// --- Timing",
    "// --- Upload",
  ],
};

for (const name of /** @type {const} */ (["tracker", "snapshot"])) {
  const headers = SECTIONS[name];
  test(`the ${name} script is its parts joined in order, as one function`, () => {
    const script = staticScript(name);
    const positions = headers.map((header) => script.indexOf(header));
    assert.ok(
      positions.every((position) => position >= 0),
      `every section of the ${name} script is present`,
    );
    assert.deepEqual(
      positions,
      [...positions].sort((a, b) => a - b),
      `the sections of the ${name} script run in order`,
    );
    assert.ok(script.startsWith("/**\n * dms-marketing"));
    assert.ok(script.endsWith("})();\n"));
    assert.equal(script.split("\n(() => {").length, 2);
  });
}
