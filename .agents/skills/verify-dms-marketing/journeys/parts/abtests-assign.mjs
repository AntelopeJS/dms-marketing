import { check, parseJson, raw, text } from "../../marketing.mjs";
import { split } from "./abtests-helpers.mjs";
import { shop } from "./funnels-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */

const CROWD = 200;
const NONE = { n: 0, conv: 0 };

/** How assignment draws an arm (7.architecture/6.ab-assignment.md, 4.usage/6.ab-tests.md). */
export const journeys = [
  {
    id: "each-split-draws-its-own-arm-and-the-weights-set-the-shares",
    title: "two splits with the same weights put a visitor on different arms about half the time (the hash takes the key); a weight of 0 never serves; weights of 1 and 3 serve about a quarter and three quarters",
    entryPoint: "GET /api/marketing/experiments.js",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await split(ctx, site, { key: "hero", weights: { a: 1, b: 1 }, arms: { a: NONE, b: NONE } });
      await split(ctx, site, { key: "promo", weights: { a: 1, b: 1 }, arms: { a: NONE, b: NONE } });
      await split(ctx, site, { key: "never-a", weights: { a: 0, b: 1 }, arms: { a: NONE, b: NONE } });
      await split(ctx, site, { key: "tilted", weights: { a: 1, b: 3 }, arms: { a: NONE, b: NONE } });
      const tally = { served: 0, differ: 0, neverA: 0, tiltedB: 0 };
      for (let visitor = 0; visitor < CROWD; visitor += 1) {
        const answer = await raw(ctx, `assignments for visitor ${visitor}`, { path: `/api/marketing/experiments.js?website=${site.id}`, headers: { "user-agent": `Mozilla/5.0 Chrome/130 crowd-${visitor}` } });
        const match = /__dmsMarketingAssignments=(\{.*\})/.exec(answer.text);
        const map = parseJson(match?.[1] ?? "{}");
        if (["hero", "promo", "never-a", "tilted"].every((key) => text(map, key) !== "")) tally.served += 1;
        if (text(map, "hero") !== text(map, "promo")) tally.differ += 1;
        if (text(map, "never-a") === "a") tally.neverA += 1;
        if (text(map, "tilted") === "b") tally.tiltedB += 1;
      }
      await ctx.verify("the draws", [
        check(`every visitor gets an arm of each of the four splits`, tally.served === CROWD, tally),
        check(`hero and promo disagree for between 70 and 130 of ${CROWD} visitors`, tally.differ >= 70 && tally.differ <= 130, tally),
        check("a weight of 0 serves nobody", tally.neverA === 0, tally),
        check(`weights 1 and 3 serve b to between 130 and 170 of ${CROWD} visitors`, tally.tiltedB >= 130 && tally.tiltedB <= 170, tally),
      ]);
    },
  },
];
