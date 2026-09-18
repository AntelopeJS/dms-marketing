import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default antelopeKnipConfig({
  // This module's tests are not where the preset looks: the antelope harness
  // config sits at the package root, and the retention suite is CommonJS
  // driving the built `dist`. Without them the only users of `mongodb` and
  // `mongodb-memory-server-core` are invisible.
  entry: ["antelope.test.ts", "tests/**/*.test.js"],
  project: ["tests/**/*.test.js"],
});
