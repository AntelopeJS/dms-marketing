#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpec, EXIT } from "@antelopejs/tooling-configs/formal";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** The findings of each configuration, with the states in TLC's shortest counterexample, in run order. */
const CONFIGS = {
  Crash: { ci: { TrailsFollowRaw: 23 }, full: { TrailsFollowRaw: 23 } },
  Stall: {
    ci: {
      OneWriter: 16,
      CountedOnce: 22,
      StoredOnce: 27,
      TrailsFollowRaw: 26,
    },
    full: {
      OneWriter: 16,
      CountedOnce: 22,
      StoredOnce: 27,
      NothingLost: 38,
    },
  },
  Trails: { ci: {}, full: {} },
};

const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--full")) {
  console.error("usage: node check.mjs [--full]");
  process.exit(EXIT.tool);
}
const mode = args.includes("--full") ? "full" : "ci";

for (const [config, findings] of Object.entries(CONFIGS)) {
  await checkSpec({
    dir,
    spec: "ImportClaimRules",
    config: mode === "full" ? config : `${config}.ci`,
    findings: findings[mode],
  });
}
