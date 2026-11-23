import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

/** Markdown is never formatted; Prettier owns the Vue layer; the journeys and their helpers, in e2e/ and in the backend suite, keep their hand-written layout. */
export default antelopeFmtPreset({
  ignorePatterns: [
    "**/*.md",
    "**/*.vue",
    "packages/dms-marketing/frontend-vue/**",
    "e2e/journeys/**",
    "e2e/*.mjs",
    "packages/dms-marketing/tests/journeys/**",
  ],
});
