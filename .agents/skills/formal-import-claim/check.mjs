#!/usr/bin/env node
/**
 * Model-checks the website claim of ImportAnalytics in
 * @antelopejs/dms-marketing, and the day-by-day replay it guards, with TLC
 * through the shared runner of @antelopejs/tooling-configs: the rules of
 * ImportClaimRules.tla on ImportClaim.tla, where a call's process can die,
 * then where a live holder can stop for 30 s and resume.
 *
 * With no argument it runs the CI configuration of each (`<config>.ci.cfg`);
 * with `--full` it runs the full one (`<config>.cfg`). Exits 0 when both
 * match the record in SKILL.md, 1 when a rule changed, and 2 when TLC could
 * not run. The runner exits on the first configuration that changed, so a
 * change under crashes skips the stall run.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkSpec, EXIT } from "@antelopejs/tooling-configs/formal";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** The findings of each configuration, with the states in TLC's shortest counterexample, in run order. */
const CONFIGS = {
  Crash: { ci: {}, full: {} },
  Stall: {
    ci: {
      OneWriter: 16,
      CountedOnce: 22,
      StoredOnce: 27,
      NothingLost: 25,
      DoneStaysDone: 19,
    },
    full: {
      OneWriter: 16,
      CountedOnce: 22,
      StoredOnce: 27,
      NothingLost: 28,
      DoneStaysDone: 22,
    },
  },
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
