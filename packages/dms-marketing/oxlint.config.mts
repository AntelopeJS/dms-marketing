import { defineConfig } from "oxlint";
import { sharedLintConfig } from "../../oxlint.config.mts";

export default defineConfig({
  ...sharedLintConfig,
  ignorePatterns: [
    ...sharedLintConfig.ignorePatterns,
    // Front-end sources, which oxlint cannot lint yet: ESLint owns the module.
    "frontend-vue/**",
    // Projects of their own, and browser payloads outside any tsconfig: the
    // type-aware pass has no types there and reads `setTimeout(callback, 0)`
    // on an untyped parameter as an implied eval.
    "playground/**",
    "static/**",
  ],
  overrides: [
    {
      // The retention suite is untyped CommonJS driving the built `dist`: the
      // table/field pairs it loops over widen to a union the rule cannot
      // interpolate, and there is no type to annotate them with.
      files: ["tests/**/*.js"],
      rules: {
        "typescript/restrict-template-expressions": "off",
      },
    },
  ],
});
