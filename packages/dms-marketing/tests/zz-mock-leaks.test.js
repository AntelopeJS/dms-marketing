const assert = require("node:assert/strict");
const models = require("@antelopejs/interface-database-decorators/model");

/**
 * A test that leaves GetModel mocked would hand its fake to every later test
 * in the process, whatever file it lives in. Runs as a root hook from the file
 * whose name sorts last, so the other files' root hooks restore their mocks
 * first.
 */
function assertGetModelRestored() {
  assert.equal("mock" in models.GetModel, false, "GetModel is still mocked");
}

afterEach(assertGetModelRestored);
