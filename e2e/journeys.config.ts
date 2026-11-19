import type { JourneysConfig } from "@antelopejs/dms/e2e";

const PLAYGROUND = "e2e/playground";

export default {
  playground: PLAYGROUND,
  prepare: [
    [
      "pnpm",
      "install",
      "--frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
    ],
    ["pnpm", "run", "build"],
    [
      "ln",
      "-sfn",
      "../../packages/dms-marketing/node_modules",
      `${PLAYGROUND}/node_modules`,
    ],
    [
      "packages/dms-marketing/node_modules/.bin/tsc",
      "-p",
      `${PLAYGROUND}/tsconfig.build.json`,
    ],
  ],
  smoke: "smoke",
} satisfies JourneysConfig;
