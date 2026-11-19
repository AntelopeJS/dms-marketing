const assert = require("node:assert/strict");
const models = require("@antelopejs/interface-database-decorators/model");

/**
 * Root hook: a test that leaves GetModel mocked would hand its fake to every
 * later test in the process, whatever file it lives in. The file name sorts
 * last so the other files' root hooks restore their mocks first.
 */
afterEach(() => {
  assert.equal("mock" in models.GetModel, false, "GetModel is still mocked");
});
