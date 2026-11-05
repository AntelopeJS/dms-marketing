/** A kind of one-way door. */
export type DoorKind = "data" | "format" | "contract" | "outbound" | "exposure" | "publish";

/** Path rules for one door kind: globs, declared funnel modules, and the journeys, as `feature/journey`, that contain it. */
export interface DoorRule {
  globs: string[];
  funnels: string[];
  containments: string[];
  why: string;
}

/** The repo-owned layer of the verification skill, read by `dms-control`. */
export interface VerifyConfig {
  playground: string;
  prepare: string[][];
  userFacing: string[];
  notUserFacing: string[];
  smoke: string;
  smokeJourney: string;
  doors: Record<DoorKind, DoorRule | null>;
  formal: never[];
}

const SKILL = ".agents/skills/verify-dms-marketing";
const MODULE = "packages/dms-marketing";
const INTERFACE = "packages/interface-dms-marketing";

const config: VerifyConfig = {
  playground: `${SKILL}/playground`,
  prepare: [
    ["pnpm", "install", "--frozen-lockfile", "--prefer-offline", "--ignore-scripts"],
    ["pnpm", "run", "build"],
    ["npm", "install", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "--prefix", SKILL, "playwright-core@1.56.1"],
    ["ln", "-sfn", `../../../../${MODULE}/node_modules`, `${SKILL}/playground/node_modules`],
    [`${MODULE}/node_modules/.bin/tsc`, "-p", `${SKILL}/playground/tsconfig.build.json`],
  ],
  userFacing: [`${MODULE}/src/**`, `${MODULE}/static/**`, `${MODULE}/frontend-vue/**`, `${MODULE}/skills/**`, `${MODULE}/package.json`, `${INTERFACE}/src/**`, `${INTERFACE}/package.json`],
  notUserFacing: [
    `${MODULE}/frontend-vue/tests/**`,
    `${MODULE}/frontend-vue/.*`,
    `${MODULE}/frontend-vue/eslint.config.mjs`,
    `${MODULE}/frontend-vue/vitest.config.ts`,
    `${MODULE}/frontend-vue/pnpm-lock.yaml`,
  ],
  smoke: "smoke",
  smokeJourney: "onboard, add a website, send a visit to the collector, read the pageview in the Overview",
  doors: {
    data: {
      globs: [
        `${MODULE}/src/services/tenant-website.ts`,
        `${MODULE}/src/services/prune.ts`,
        `${MODULE}/src/services/snapshots.ts`,
        `${MODULE}/src/db/models/retention.ts`,
        `${MODULE}/src/routes/websites.ts`,
        `${MODULE}/src/routes/stats.ts`,
        `${MODULE}/src/routes/settings.ts`,
        `${MODULE}/src/data-api/funnels.ts`,
        `${MODULE}/src/hooks/index.ts`,
      ],
      funnels: [],
      containments: ["websites/purges-and-deletion-take-only-the-sites-own-data", "content/deleting-the-workspace-purges-every-marketing-table-then-its-websites"],
      why: "these purge, delete and prune collected events, sessions, rollups, snapshots and funnels, which a revert of the code does not bring back",
    },
    format: {
      globs: [`${MODULE}/src/db/**`, `${MODULE}/src/services/rollup-write.ts`, `${MODULE}/src/types/events.ts`, `${MODULE}/src/types/statistics.ts`, `${MODULE}/src/types/snapshots.ts`],
      funnels: [],
      containments: [],
      why: "the stored events, sessions, daily rollups, snapshots and funnels are read back by the next version of the module",
    },
    contract: {
      globs: [
        `${MODULE}/package.json`,
        `${MODULE}/src/routes/**`,
        `${MODULE}/src/config.ts`,
        `${MODULE}/static/tracker/**`,
        `${INTERFACE}/package.json`,
        `${INTERFACE}/src/**`,
        `${MODULE}/frontend-vue/package.json`,
      ],
      funnels: [],
      containments: [],
      why: "tracked sites embed the tracker and post the event contract, other modules import the interface, and projects set the config keys and the renderer range",
    },
    outbound: null,
    exposure: {
      globs: [
        `${MODULE}/src/routes/collect.ts`,
        `${MODULE}/src/routes/public-endpoints.ts`,
        `${MODULE}/src/routes/snapshot.ts`,
        `${MODULE}/src/routes/experiments.ts`,
        `${MODULE}/src/routes/tracker.ts`,
        `${MODULE}/src/services/origin-guard.ts`,
        `${MODULE}/src/services/ingest-guard.ts`,
        `${MODULE}/src/data-api/tenant-scope.ts`,
      ],
      funnels: [],
      containments: [],
      why: "these routes answer without a session for any site on the internet, and the origin and rate guards decide whose events are stored",
    },
    publish: {
      globs: [`${MODULE}/package.json`, `${INTERFACE}/package.json`, `${MODULE}/.release-it.json`, `${INTERFACE}/.release-it.json`, `${MODULE}/scripts/publish.mjs`, ".github/workflows/release.yml", ".github/workflows/release-interface.yml"],
      funnels: [],
      containments: [],
      why: "the package names, their files and the release workflows claim @antelopejs/dms-marketing and @antelopejs/interface-dms-marketing in the npm registry",
    },
  },
  formal: [],
};

export default config;
