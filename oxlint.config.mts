import { defineConfig } from "oxlint";
import {
  ANTELOPE_IGNORE_PATTERNS,
  antelopePreset,
} from "@antelopejs/tooling-configs/oxc/lint";

/**
 * The repository-wide rule set. Package configs spread it and add only what is
 * specific to them, so the rules themselves are declared once.
 */
export const sharedLintConfig = {
  extends: [
    antelopePreset({
      // Off everywhere for now: import sorting gets turned on repository-wide
      // in one pass, so the reordering lands as a single reviewable change.
      importSorting: false,
    }),
  ],
  ignorePatterns: ANTELOPE_IGNORE_PATTERNS,
  options: {
    typeAware: true,
    // Starts at zero and never goes up: a single new warning fails CI.
    maxWarnings: 0,
  },
};

export default defineConfig(sharedLintConfig);
