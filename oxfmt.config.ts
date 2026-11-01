import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/** Markdown is never formatted; Prettier owns the Vue layer. */
export default antelopeFmtPreset({
  ignorePatterns: [
    "**/*.md",
    "**/*.vue",
    "packages/dms-marketing/frontend-vue/**",
    "packages/dms-marketing/playground/**",
    "packages/dms-marketing/static/**",
  ],
});
