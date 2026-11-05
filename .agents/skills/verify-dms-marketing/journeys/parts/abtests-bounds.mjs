import { check, mkt, num, pick, same } from "../../marketing.mjs";
import { declare, results, shop } from "./funnels-helpers.mjs";
import { split } from "./abtests-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */
/** @typedef {import("../../site.mjs").Site} Site */

const STEPS = [{ kind: "url", value: "/pricing" }];

/**
 * @param {number} count How many variations
 * @param {string} [prefix] Their key prefix
 * @returns {{ key: string, weight: number }[]} The variations
 */
function arms(count, prefix = "v") {
  return Array.from({ length: count }, (_, index) => ({ key: `${prefix}${index}`, weight: 1 }));
}

/**
 * Whether a split is accepted, through the interface (`EnsureFunnel`) or through the builder's data route.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {"interface" | "builder"} route The way in
 * @param {string} key The experiment key
 * @param {{ key: string, weight: number }[]} variations The variations
 * @returns {Promise<boolean>} Whether it was accepted
 */
export async function accepts(ctx, site, route, key, variations) {
  const id = ctx.unique("try").replace(/\W+/g, "-");
  if (route === "interface") {
    const answer = await declare(ctx, site, { id, steps: STEPS, experiment: { key, variations } });
    return pick(answer.body, "ok") === true;
  }
  const answer = await mkt(ctx, `try ${key} through the builder`, "POST", "/tables/funnels/new", { body: { websiteId: site.id, name: id, steps: STEPS, experiment: { key, variations } } });
  return answer.status === 200;
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }[]} */
export const journeys = [
  {
    id: "a-split-has-2-to-8-variations",
    title: "1 and 9 variations are refused, 2 and 8 are accepted, through the interface and through the builder's data route",
    entryPoint: "EnsureFunnel, POST /api/marketing/tables/funnels/new",
    async run(ctx) {
      const site = await shop(ctx);
      for (const route of /** @type {const} */ (["interface", "builder"])) {
        const results = [];
        for (const count of [1, 2, 8, 9]) results.push([count, await accepts(ctx, site, route, `${route}-n${count}`, arms(count))]);
        await ctx.verify(`${route}: the number of variations`, [same("accepted by count", results, [[1, false], [2, true], [8, true], [9, false]])]);
      }
    },
  },
  {
    id: "keys-start-with-a-letter-or-digit-and-hold-lowercase-digits-dash-underscore",
    title: "experiment keys and variation keys: -x, _x, Hx, a b, an empty key and 65 characters are refused; h-1_x, 0abc and 64 characters are accepted",
    entryPoint: "EnsureFunnel, POST /api/marketing/tables/funnels/new",
    async run(ctx) {
      const cases = [
        ["-hero", false],
        ["_hero", false],
        ["Hero", false],
        ["a b", false],
        ["a.b", false],
        ["x".repeat(65), false],
        ["h-1_x", true],
        ["0abc", true],
        ["z".repeat(64), true],
      ];
      for (const route of /** @type {const} */ (["interface", "builder"])) {
        const site = await shop(ctx);
        const experimentKeys = [];
        for (const [key, expected] of cases) {
          const keyed = expected && String(key).length < 60 ? `${String(key)}-${route}` : String(key);
          experimentKeys.push([String(key).slice(0, 12), (await accepts(ctx, site, route, keyed, arms(2))) === expected]);
        }
        await ctx.verify(`${route}: experiment keys`, [same("each answer is the documented one", experimentKeys.filter(([, right]) => right !== true), [])]);
        const variationKeys = [];
        for (const [key, expected] of cases) {
          const variations = [{ key: String(key), weight: 1 }, { key: "other", weight: 1 }];
          variationKeys.push([String(key).slice(0, 12), (await accepts(ctx, site, route, `vk-${route}-${variationKeys.length}`, variations)) === expected]);
        }
        await ctx.verify(`${route}: variation keys`, [same("each answer is the documented one", variationKeys.filter(([, right]) => right !== true), [])]);
      }
    },
  },
  {
    id: "weights-are-zero-or-more-and-one-is-above-zero",
    title: "all weights 0 and a negative weight are refused; weights 0 and 1 are accepted and the weightless arm is never served",
    entryPoint: "EnsureFunnel, POST /api/marketing/tables/funnels/new",
    async run(ctx) {
      const site = await shop(ctx);
      for (const route of /** @type {const} */ (["interface", "builder"])) {
        const attempt = (/** @type {number[]} */ weights, /** @type {string} */ name) => accepts(ctx, site, route, `w-${route}-${name}`, weights.map((weight, index) => ({ key: `arm${index}`, weight })));
        await ctx.verify(`${route}: weights`, [
          same("all zero", await attempt([0, 0], "zero"), false),
          same("a negative weight", await attempt([-1, 2], "negative"), false),
          same("0 and 1", await attempt([0, 1], "one"), true),
          same("1 and 3", await attempt([1, 3], "three"), true),
          same("0, 0 and 5", await attempt([0, 0, 5], "five"), true),
        ]);
      }
      const served = await shop(ctx);
      await split(ctx, served, { key: "never", weights: { a: 0, b: 1 }, arms: { a: { n: 0, conv: 0 }, b: { n: 0, conv: 0 } } });
      const { raw } = await import("../../marketing.mjs");
      const seen = new Set();
      for (let visitor = 0; visitor < 12; visitor += 1) {
        const answer = await raw(ctx, `assignment ${visitor}`, { path: `/api/marketing/experiments.js?website=${served.id}`, headers: { "user-agent": `Mozilla/5.0 Chrome/130 weight-${visitor}` } });
        seen.add(/"never":"([^"]*)"/.exec(answer.text)?.[1] ?? "none");
      }
      await ctx.verify("a weight of 0 is never served", [same("arms served", [...seen], ["b"])]);
    },
  },
  {
    id: "each-challenger-is-tested-at-0-05-over-the-number-of-challengers",
    title: "two arms test at 0.05, three at 0.025 and four at 0.05/3; a challenger with p between 0.025 and 0.05 is not significant against two challengers and has no winner verdict, one with p below 0.025 is",
    entryPoint: "GET /api/marketing/funnels/:id/results",
    async run(ctx) {
      const specs = {
        near: { a: { n: 200, conv: 60 }, b: { n: 200, conv: 80 }, c: { n: 200, conv: 55 } },
        far: { a: { n: 200, conv: 60 }, b: { n: 200, conv: 90 }, c: { n: 200, conv: 55 } },
        two: { a: { n: 200, conv: 60 }, b: { n: 200, conv: 80 } },
        four: { a: { n: 200, conv: 60 }, b: { n: 200, conv: 80 }, c: { n: 200, conv: 55 }, d: { n: 200, conv: 52 } },
      };
      /** @type {Record<string, Awaited<ReturnType<typeof results>>>} */
      const read = {};
      for (const [name, armsSpec] of Object.entries(specs)) {
        const site = await shop(ctx);
        const id = await split(ctx, site, { key: name, arms: armsSpec });
        read[name] = await results(ctx, site, id);
      }
      const arm = (/** @type {string} */ name, /** @type {string} */ key) => /** @type {Record<string, unknown>[]} */ (pick(read[name]?.answer.body, "experiment", "variations") ?? []).find((entry) => entry.key === key);
      await ctx.verify("the significance level of each comparison", [
        same("alpha with two, three and four arms", [num(read.two?.answer.body, "experiment", "alpha"), num(read.near?.answer.body, "experiment", "alpha"), num(read.four?.answer.body, "experiment", "alpha")], [0.05, 0.025, 0.05 / 3]),
        check("b against a: p about 0.036", Math.abs(num(arm("near", "b"), "pValue") - 0.036) < 0.002, pick(arm("near", "b"), "pValue")),
        same("0.036 is significant at 0.05 (two arms) and not at 0.025 (three arms)", [pick(arm("two", "b"), "significant"), pick(arm("near", "b"), "significant")], [true, false]),
        same("no winner while the best challenger is not significant", pick(read.near?.answer.body, "verdict", "kind") === "winner", false),
        same("p about 0.002 is significant at 0.025, a winner with a full week and 50 conversions per arm", [pick(arm("far", "b"), "significant"), pick(read.far?.answer.body, "verdict", "kind")], [true, "winner"]),
      ]);
    },
  },
];
