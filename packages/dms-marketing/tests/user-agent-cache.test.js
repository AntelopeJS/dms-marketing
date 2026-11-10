const assert = require("node:assert/strict");
const test = it;
const { memoizeBounded } = require("../dist/services/bounded-cache");
const { parseDevice } = require("../dist/services/user-agent");

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

test("one agent parses to equal devices that are never the same object", () => {
  const first = parseDevice(IPHONE);
  const second = parseDevice(IPHONE);
  assert.deepEqual(first, {
    browser: "Mobile Safari",
    os: "iOS",
    deviceType: "mobile",
  });
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
});

test("a memoized key computes once, and the oldest key computes again past the cap", () => {
  const computed = [];
  const lengthOf = memoizeBounded((key) => {
    computed.push(key);
    return key.length;
  }, 2);
  assert.equal(lengthOf("a"), 1);
  assert.equal(lengthOf("a"), 1);
  lengthOf("bb");
  lengthOf("ccc");
  assert.equal(lengthOf("bb"), 2);
  assert.equal(lengthOf("a"), 1);
  assert.deepEqual(computed, ["a", "bb", "ccc", "a"]);
});
