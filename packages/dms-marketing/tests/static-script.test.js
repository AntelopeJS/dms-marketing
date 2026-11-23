const assert = require("node:assert/strict");
const vm = require("node:vm");
const { staticScript } = require("../dist/services/static-script");
const test = it;

for (const name of /** @type {const} */ (["tracker", "snapshot"])) {
  test(`the ${name} script is a classic script that follows the statement the route prepends`, () => {
    assert.doesNotThrow(
      () =>
        new vm.Script(`window.__dmsMarketingConfig={};\n${staticScript(name)}`),
    );
  });

  test(`the ${name} script keeps its helpers out of the page's global scope`, () => {
    /** @type {Record<string, unknown>} */
    const page = { document: { currentScript: null } };
    page.window = page;
    const before = Object.keys(page);
    vm.runInNewContext(staticScript(name), page);
    assert.deepEqual(Object.keys(page), before);
  });
}
