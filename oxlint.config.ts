import { defineConfig } from "oxlint";
import {
  ANTELOPE_IGNORE_PATTERNS,
  antelopePreset,
} from "@antelopejs/tooling-configs/oxc/lint";

/**
 * ESLint owns the Vue layer. The playground and the static browser payloads sit
 * outside any tsconfig, so the type-aware pass would read them untyped.
 */
const MODULE_IGNORE_PATTERNS = [
  "packages/dms-marketing/frontend-vue/**",
  "packages/dms-marketing/playground/**",
  "packages/dms-marketing/static/**",
];

export default defineConfig({
  extends: [antelopePreset({ importSorting: false })],
  ignorePatterns: [...ANTELOPE_IGNORE_PATTERNS, ...MODULE_IGNORE_PATTERNS],
  options: {
    typeAware: true,
    maxWarnings: 0,
  },
  overrides: [
    {
      files: ["packages/dms-marketing/tests/**/*.js"],
      rules: {
        "typescript/restrict-template-expressions": "off",
      },
    },
  ],
});
