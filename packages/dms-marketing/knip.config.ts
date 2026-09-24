import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

export default Object.assign(
  antelopeKnipConfig({
    entry: [
      // This module's tests are not where the preset looks: the antelope harness
      // config sits at the package root, and the retention suite is CommonJS
      // driving the built `dist`. Without them the only users of `mongodb` and
      // `mongodb-memory-server-core` are invisible.
      "antelope.test.ts",
      "tests/**/*.test.js",
      // The retention suite requires the prune steps from `dist`, which Knip
      // does not map back onto `src`, so their exports would read as unused.
      "src/services/prune.ts",
      // AntelopeJS discovers these at runtime through their decorators and
      // RegisterModule, not through an import of the exported class, so Knip
      // would report every controller, page and module as an unused export.
      "src/data-api/{funnels,websites}.ts",
      "src/pages/module.ts",
      "src/pages/*/page.ts",
      "src/routes/!(index).ts",
    ],
    project: ["tests/**/*.test.js"],
  }),
  {
    ignoreIssues: {
      // Aliases such as SNAPSHOT_REFRESH_AGE_MS = MS_PER_DAY are deliberate:
      // each names a tuning knob that happens to equal a unit today.
      "src/types/constants.ts": ["duplicates"],
    },
  },
);
