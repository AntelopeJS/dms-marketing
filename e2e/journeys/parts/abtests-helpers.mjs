import { fixture, pick, same } from "../../marketing.mjs";
import { declare } from "./funnels-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */
/** @typedef {import("../../site.mjs").Site} Site */
/** @typedef {Record<string, { n: number, conv: number }>} Arms */

const DAY_MS = 24 * 60 * 60 * 1000;
const STEPS = [{ kind: "url", value: "/pricing" }, { kind: "custom", value: "signup" }];

/**
 * Declares a funnel split in a state, then replays exposed sessions through the live pipeline: each arm has `n`
 * sessions that saw `/pricing` and were exposed to the arm, `conv` of them signed up.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {{ id?: string, key?: string, weights?: Record<string, number>, status?: "draft" | "running" | "stopped", startedDaysAgo?: number, arms: Arms, stoppedMinutesAgo?: number }} spec The split and its traffic
 * @returns {Promise<string>} The funnel id
 */
export async function split(ctx, site, spec) {
  const id = spec.id ?? ctx.unique("split").replace(/\W+/g, "-");
  const key = spec.key ?? "hero";
  const keys = Object.keys(spec.arms);
  /** @type {{ key: string, status: string, startedAt: number, stoppedAt?: number, variations: { key: string, weight: number }[] }} */
  const experiment = {
    key,
    status: spec.status ?? "running",
    startedAt: Date.now() - (spec.startedDaysAgo ?? 10) * DAY_MS,
    variations: keys.map((name) => ({ key: name, weight: spec.weights?.[name] ?? 1 })),
  };
  if (spec.status === "stopped") experiment.stoppedAt = Date.now() - (spec.stoppedMinutesAgo ?? 5) * 60_000;
  const declared = await declare(ctx, site, { id, name: "Hero", steps: STEPS, experiment });
  await ctx.verify("the split is declared", [same("answer", pick(declared.body, "result", "status"), "created")], { critical: true });
  const start = Date.now() - 3_600_000;
  let counter = 0;
  const sessions = keys.flatMap((name) =>
    Array.from({ length: spec.arms[name]?.n ?? 0 }, (_, index) => {
      counter += 1;
      const at = (/** @type {number} */ seconds) => new Date(start + counter * 5000 + seconds * 1000).toISOString();
      const url = `https://${site.domain}/pricing`;
      return {
        visitor: `${name}-${index}`,
        events: [
          { kind: "pageview", at: at(0), url },
          { kind: "exposure", at: at(1), url, name: key, data: { experiment: key, variation: name } },
          ...(index < (spec.arms[name]?.conv ?? 0) ? [{ kind: "custom", at: at(2), url, name: "signup" }] : []),
        ],
      };
    }),
  );
  const imported = await fixture(ctx, "replay the exposed sessions", "POST", "/import", { tenantId: "default", importId: ctx.unique("split").replace(/\W+/g, "-"), websiteId: site.id, sessions });
  await ctx.verify("the traffic is imported", [same("status", pick(imported.body, "result", "status"), "imported")], { critical: true });
  return id;
}

/**
 * The two-sided p-value of a normal deviate, from the complementary error function (Abramowitz and Stegun 7.1.26,
 * absolute error under 1.5e-7).
 *
 * @param {number} z The deviate
 * @returns {number} P(|Z| >= |z|)
 */
export function twoSidedP(z) {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return poly * Math.exp(-x * x);
}

/**
 * The pooled two-proportion z statistic.
 *
 * @param {number} convA Conversions of the control
 * @param {number} nA Sessions of the control
 * @param {number} convB Conversions of the challenger
 * @param {number} nB Sessions of the challenger
 * @returns {number} z
 */
export function zScore(convA, nA, convB, nB) {
  const pooled = (convA + convB) / (nA + nB);
  return (convB / nB - convA / nA) / Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
}
