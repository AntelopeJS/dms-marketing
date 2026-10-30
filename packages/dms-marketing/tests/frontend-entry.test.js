const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = it;

const PACKAGE_ROOT = path.join(__dirname, "..");

test("the dmsFrontend entry loads under plain Node, without the AntelopeJS path aliases", () => {
  const entry = require("../package.json").dmsFrontend;
  const exported = execFileSync(
    process.execPath,
    [
      "-e",
      "process.stdout.write(JSON.stringify(Object.keys(require(process.argv[1]))))",
      path.join(PACKAGE_ROOT, entry),
    ],
    {
      cwd: PACKAGE_ROOT,
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "" },
    },
  );
  assert.deepEqual(JSON.parse(exported), [
    "DASHBOARD_MODULE_AREA_PATHS",
    "dashboardExcludedPaths",
    "dashboardFrontendOptions",
    "frontendModule",
  ]);
});
