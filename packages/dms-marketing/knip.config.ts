import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";

/**
 * Knip for the module. The entries add what the preset does not find: the
 * antelope harness config at the package root and the CommonJS suites under
 * `tests/` that drive the built `dist` (without them the only users of
 * `mongodb` and `mongodb-memory-server-core` are invisible);
 * `src/services/prune.ts`, whose prune steps the retention suite requires from
 * `dist`, which Knip does not map back onto `src`; and the controllers, pages
 * and module AntelopeJS discovers at runtime through their decorators and
 * RegisterModule, not through an import of the exported class.
 *
 * The duplicate exports of `src/types/constants.ts` are deliberate aliases such
 * as `SNAPSHOT_REFRESH_AGE_MS = MS_PER_DAY`: each names a tuning knob that
 * happens to equal a unit today.
 */
export default Object.assign(
  antelopeKnipConfig({
    entry: [
      "antelope.test.ts",
      "tests/**/*.test.js",
      "src/services/prune.ts",
      "src/data-api/{funnels,websites}.ts",
      "src/pages/module.ts",
      "src/pages/*/page.ts",
      "src/routes/!(index).ts",
    ],
    project: ["tests/**/*.test.js"],
  }),
  {
    ignoreIssues: {
      "src/types/constants.ts": ["duplicates"],
    },
  },
);
