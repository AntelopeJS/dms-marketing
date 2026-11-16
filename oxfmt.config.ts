import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/** Markdown is never formatted; Prettier owns the Vue layer; the journeys and their helpers keep the layout they had in the verify skill. */
export default antelopeFmtPreset({
  ignorePatterns: [
    "**/*.md",
    "**/*.vue",
    "packages/dms-marketing/frontend-vue/**",
    "packages/dms-marketing/playground/**",
    "packages/dms-marketing/static/**",
    "e2e/journeys/**",
    "e2e/*.mjs",
  ],
});
