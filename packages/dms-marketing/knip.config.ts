import { antelopeKnipConfig } from "@antelopejs/tooling-configs/knip";
import type { KnipConfig } from "knip";

/**
 * Knip for the module. The entries add what the preset does not find: the
 * antelope harness config at the package root and the CommonJS suites under
 * `tests/` that drive the built `dist` (without them the only users of
 * `mongodb` and `mongodb-memory-server-core` are invisible);
 * `src/services/prune.ts`, whose prune steps the retention suite requires from
 * `dist`, which Knip does not map back onto `src`; and the controllers, pages
 * and module AntelopeJS discovers at runtime through their decorators and
 * RegisterModule, not through an import of the exported class; the two
 * entries of the browser scripts that `scripts/build-static.mts` bundles; and
 * the parts of the capture script that the unit suite bundles through
 * `tests/helpers/snapshot-module.js`.
 *
 * The duplicate exports of `src/types/constants.ts` are deliberate aliases such
 * as `SNAPSHOT_REFRESH_AGE_MS = MS_PER_DAY`: each names a tuning knob that
 * happens to equal a unit today.
 */
const config: KnipConfig = Object.assign(
  antelopeKnipConfig({
    entry: [
      "antelope.test.ts",
      "tests/**/*.test.js",
      "src/services/prune.ts",
      "src/data-api/{funnels,websites}.ts",
      "src/pages/module.ts",
      "src/pages/*/page.ts",
      "src/routes/!(index).ts",
      "static/{tracker,snapshot}/index.ts",
      "static/snapshot/pure-parts.ts",
    ],
    project: ["tests/**/*.test.js", "static/**/*.ts"],
  }),
  {
    ignoreIssues: {
      "src/types/constants.ts": ["duplicates"],
    },
  },
);

export default config;
