const assert = require("node:assert/strict");
const test = it;
const { TRACKER_PUBLIC_ENDPOINTS } = require("../dist/routes/public-endpoints");

function methodsOf(path) {
  return TRACKER_PUBLIC_ENDPOINTS.find((endpoint) => endpoint.path === path)
    ?.methods;
}

test("a tracked site's beacons reach the backend through the dashboard origin", () => {
  assert.deepEqual(methodsOf("/api/marketing/collect"), ["POST"]);
  assert.deepEqual(methodsOf("/api/marketing/snapshot"), ["POST"]);
});

test("the scripts a tracked site loads are served without a session", () => {
  for (const script of ["tracker.js", "experiments.js", "snapshot.js"]) {
    assert.deepEqual(methodsOf(`/api/marketing/${script}`), ["GET", "HEAD"]);
  }
});
