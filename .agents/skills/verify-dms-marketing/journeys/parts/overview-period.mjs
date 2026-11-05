import { mkt, num, same } from "../../marketing.mjs";
import { block, history, period, shop } from "./overview-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */

/** The default period and a 7-day window's edges (7.architecture/4.context-and-period.md). */
export const journeys = [
  {
    id: "a-read-without-a-period-covers-today-and-the-6-days-before",
    title: "with no period the Overview reads 7 days: a session 6 days ago counts, one 7 days ago does not; a 7-day window from the period scope reads the same days",
    entryPoint: "GET /api/marketing/stats/overview, GET /api/marketing/blocks/kpi",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await history(ctx, site, [
        { visitor: "day-6", daysAgo: 6, minutes: [0], paths: ["/a"] },
        { visitor: "day-7", daysAgo: 7, minutes: [0], paths: ["/a"] },
      ]);
      const unscoped = await mkt(ctx, "the overview with no period", "GET", `/stats/overview?website=${site.id}`);
      const week = await block(ctx, site, "/blocks/kpi?metric=pageviews", period(6, 0, "none"));
      await ctx.verify("the window edges", [
        same("no period: the session of 6 days ago only", num(unscoped.body, "totals", "pageviews"), 1),
        same("the last 7 days from the period scope: the session of 6 days ago only", num(week.body, "value"), 1),
      ]);
    },
  },
];
