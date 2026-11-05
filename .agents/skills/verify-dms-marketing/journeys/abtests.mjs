import { guarded } from "../guard.mjs";
import { check, list, mkt, num, pick, same } from "../marketing.mjs";
import { journeys as lifecycle } from "./parts/abtests-lifecycle.mjs";
import { journeys as bounds } from "./parts/abtests-bounds.mjs";
import { split, twoSidedP, zScore } from "./parts/abtests-helpers.mjs";
import { results, shop } from "./parts/funnels-helpers.mjs";
import { journeys as assignment } from "./parts/abtests-assign.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */

/**
 * @param {Awaited<ReturnType<typeof results>>} read A split's results
 * @returns {Record<string, unknown>} The arm of the challenger, by key
 */
function arms(read) {
  return Object.fromEntries(list(read.answer.body, "experiment", "variations").map((arm) => [String(arm.key), arm]));
}

/** A/B tests: the reading, the verdicts and the checks (4.usage/6.ab-tests.md). */
export const journeys = guarded([
  ...bounds,
  ...lifecycle,
  {
    id: "an-arm-is-scored-per-exposed-session-with-a-two-sided-z-test",
    title: "each arm reports its exposed sessions, conversions and rate; the challenger's lift and p-value match an independent two-proportion z-test; the split check passes on a balanced split",
    entryPoint: "GET /api/marketing/funnels/:id/results",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      const id = await split(ctx, site, { arms: { a: { n: 40, conv: 10 }, b: { n: 40, conv: 25 } } });
      const read = await results(ctx, site, id);
      const byKey = arms(read);
      const expectedP = twoSidedP(zScore(10, 40, 25, 40));
      await ctx.verify("the arms", [
        same("control", [pick(byKey.a, "exposedSessions"), pick(byKey.a, "conversions"), pick(byKey.a, "conversionRate")], [40, 10, 0.25]),
        same("challenger", [pick(byKey.b, "exposedSessions"), pick(byKey.b, "conversions"), pick(byKey.b, "conversionRate")], [40, 25, 0.625]),
        same("the control has no lift or p-value", [pick(byKey.a, "uplift"), pick(byKey.a, "pValue")], [null, null]),
        same("relative lift of the challenger", pick(byKey.b, "uplift"), 1.5),
        check("p-value matches the pooled two-proportion z-test", Math.abs(num(byKey.b, "pValue") - expectedP) / expectedP < 0.01, [num(byKey.b, "pValue"), expectedP]),
        same("significant below 0.05", pick(byKey.b, "significant"), true),
        check("the lift interval brackets the lift", num(byKey.b, "upliftLow") < 1.5 && num(byKey.b, "upliftHigh") > 1.5, [pick(byKey.b, "upliftLow"), pick(byKey.b, "upliftHigh")]),
        same("each arm is scored against its own exposed sessions, step by step", list(byKey.b, "computation", "steps").map((step) => step.sessions), [40, 25]),
        same("the split check passes", pick(read.answer.body, "experiment", "srm", "mismatch"), false),
        same("the control is the first variation", pick(read.answer.body, "experiment", "control"), "a"),
      ]);
    },
  },
  {
    id: "a-significant-reading-is-ready-after-a-week-and-50-conversions-per-arm",
    title: "significant but under 7 days served, or with 49 conversions in the control, reads early; at 7 days and 50 conversions per arm it is a winner",
    entryPoint: "GET /api/marketing/funnels/:id/results",
    async run(/** @type {Ctx} */ ctx) {
      const readyData = { a: { n: 120, conv: 50 }, b: { n: 120, conv: 90 } };
      /** @type {[string, Parameters<typeof split>[2], string, boolean][]} */
      const cases = [
        ["a full week and 50 conversions per arm", { startedDaysAgo: 10, arms: readyData }, "winner", true],
        ["6 days served", { startedDaysAgo: 6, arms: readyData }, "early", false],
        ["49 conversions in the control", { startedDaysAgo: 10, arms: { a: { n: 120, conv: 49 }, b: { n: 120, conv: 90 } } }, "early", false],
      ];
      for (const [label, spec, kind, ready] of cases) {
        const site = await shop(ctx);
        const id = await split(ctx, site, spec);
        const read = await results(ctx, site, id);
        const verdict = pick(read.answer.body, "verdict", "kind");
        await ctx.verify(`${label}: ${kind}`, [same("verdict", verdict, kind), same("ready", pick(read.answer.body, "experiment", "decision", "ready"), ready), same("the thresholds", [pick(read.answer.body, "experiment", "decision", "minDays"), pick(read.answer.body, "experiment", "decision", "minConversions")], [7, 50])]);
      }
    },
  },
  {
    id: "a-challenger-below-the-control-and-a-flat-reading-and-a-thin-sample",
    title: "a significantly worse challenger is a loser, no difference is flat, and under 5 converted or 5 not converted in an arm the verdict is withheld with the counts",
    entryPoint: "GET /api/marketing/funnels/:id/results",
    async run(/** @type {Ctx} */ ctx) {
      /** @type {[string, Parameters<typeof split>[2]][]} */
      const cases = [
        ["loser", { arms: { a: { n: 120, conv: 90 }, b: { n: 120, conv: 50 } } }],
        ["flat", { arms: { a: { n: 120, conv: 60 }, b: { n: 120, conv: 61 } } }],
        ["withheld", { arms: { a: { n: 40, conv: 20 }, b: { n: 40, conv: 4 } } }],
        ["early", { arms: { a: { n: 40, conv: 20 }, b: { n: 40, conv: 5 } } }],
      ];
      for (const [kind, spec] of cases) {
        const site = await shop(ctx);
        const id = await split(ctx, site, spec);
        const read = await results(ctx, site, id);
        await ctx.verify(`${kind}`, [same("verdict kind", pick(read.answer.body, "verdict", "kind"), kind)]);
      }
    },
  },
  {
    id: "a-sample-ratio-mismatch-withholds-the-verdict",
    title: "an observed split far from the configured weights (chi-square p < 0.001) is flagged and the verdict is withheld",
    entryPoint: "GET /api/marketing/funnels/:id/results",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      const id = await split(ctx, site, { arms: { a: { n: 150, conv: 30 }, b: { n: 50, conv: 25 } } });
      const read = await results(ctx, site, id);
      await ctx.verify("the split check fails", [same("mismatch", pick(read.answer.body, "experiment", "srm", "mismatch"), true), same("expected and observed", [pick(read.answer.body, "experiment", "srm", "expected"), pick(read.answer.body, "experiment", "srm", "observed")], [[100, 100], [150, 50]]), same("verdict", pick(read.answer.body, "verdict", "kind"), "withheld")]);
      const balanced = await shop(ctx);
      const okId = await split(ctx, balanced, { arms: { a: { n: 100, conv: 30 }, b: { n: 100, conv: 25 } } });
      const okRead = await results(ctx, balanced, okId);
      await ctx.verify("a balanced split passes", [same("mismatch", pick(okRead.answer.body, "experiment", "srm", "mismatch"), false)]);
    },
  },
  {
    id: "the-assignment-script-serves-running-splits-per-visitor",
    title: "experiments.js answers the arm of every running split, the same visitor gets the same arm, a weight of 0 never serves, the answer is private and uncached, and a draft, a stopped split or a paused module serve nothing",
    entryPoint: "GET /api/marketing/experiments.js",
    async run(/** @type {Ctx} */ ctx) {
      const { raw } = await import("../marketing.mjs");
      const site = await shop(ctx);
      const read = async (/** @type {string} */ visitor) => {
        const answer = await raw(ctx, `assignment for ${visitor}`, { path: `/api/marketing/experiments.js?website=${site.id}`, headers: { "user-agent": `Mozilla/5.0 Chrome/130 ${visitor}` } });
        const match = /__dmsMarketingAssignments=(\{.*\})/.exec(answer.text);
        return { answer, map: /** @type {Record<string, string>} */ (match ? JSON.parse(match[1] ?? "{}") : null) };
      };
      await split(ctx, site, { key: "hero", weights: { a: 1, b: 1 }, arms: { a: { n: 0, conv: 0 }, b: { n: 0, conv: 0 } } });
      const first = await read("visitor-1");
      const again = await read("visitor-1");
      await ctx.verify("the script", [
        same("content type and cache", [first.answer.headers["content-type"]?.split(";")[0], first.answer.headers["cache-control"]], ["application/javascript", "private, no-store"]),
        same("the same visitor gets the same arm", first.map, again.map),
        check("the arm is one of the variations", ["a", "b"].includes(String(first.map?.hero)), first.map),
      ]);
      const counts = { a: 0, b: 0 };
      for (let visitor = 0; visitor < 60; visitor += 1) {
        const arm = String((await read(`crowd-${visitor}`)).map?.hero);
        if (arm === "a" || arm === "b") counts[arm] += 1;
      }
      await ctx.verify("equal weights split a crowd", [check("both arms are served, neither takes more than 80 of 100", counts.a + counts.b === 60 && counts.a >= 12 && counts.b >= 12, counts)]);
      const unknown = await raw(ctx, "an unknown website", { path: "/api/marketing/experiments.js?website=does-not-exist" });
      const missing = await raw(ctx, "no website", { path: "/api/marketing/experiments.js" });
      await ctx.verify("unknown and missing websites", [same("unknown: an empty map", [unknown.status, /__dmsMarketingAssignments=\{\}/.test(unknown.text)], [200, true]), same("no website: 400", missing.status, 400)]);
      const paused = await mkt(ctx, "pause the module", "POST", "/settings/collection", { body: { enabled: false } });
      const whilePaused = await read("visitor-1");
      await mkt(ctx, "resume the module", "POST", "/settings/collection", { body: { enabled: true } });
      await ctx.verify("a paused module serves nothing", [same("paused", paused.status, 200), same("empty map", whilePaused.map, {})]);
    },
  },
  ...assignment,
]);
