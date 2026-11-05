import { fixture, pick, same } from "../../marketing.mjs";
import { declare, results, shop } from "./funnels-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */

const MINUTE = 60_000;
const STEPS = [{ kind: "url", value: "/pricing" }, { kind: "url", value: "/plans" }, { kind: "url", value: "/checkout" }];

/** The conversion window's edges (4.usage/5.funnels.md, "Conversion window"). */
export const journeys = [
  {
    id: "the-window-counts-from-the-first-step-and-ends-on-its-last-instant",
    title: "a 1-hour window takes a goal exactly 60 minutes after step 1 and refuses one a second later; a goal 50 minutes after step 2 but 75 after step 1 is refused",
    entryPoint: "GET /api/marketing/funnels/:id/results",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await declare(ctx, site, { id: "hour", steps: STEPS, conversionWindowHours: 1 });
      const start = Date.now() - 6 * 60 * MINUTE;
      const visit = (/** @type {string} */ visitor, /** @type {[string, number][]} */ pages) => ({
        visitor,
        events: pages.map(([path, ms]) => ({ kind: "pageview", at: new Date(start + ms).toISOString(), url: `https://${site.domain}${path}` })),
      });
      const answer = await fixture(ctx, "import three sessions around the window's edge, no page more than 25 minutes after the one before", "POST", "/import", {
        tenantId: "default",
        importId: "window-edges",
        websiteId: site.id,
        sessions: [
          visit("on-the-edge", [["/pricing", 0], ["/plans", 10 * MINUTE], ["/read", 35 * MINUTE], ["/checkout", 60 * MINUTE]]),
          visit("a-second-late", [["/pricing", 0], ["/plans", 10 * MINUTE], ["/read", 35 * MINUTE], ["/checkout", 60 * MINUTE + 1000]]),
          visit("late-from-step-1", [["/pricing", 0], ["/plans", 25 * MINUTE], ["/read", 50 * MINUTE], ["/checkout", 75 * MINUTE]]),
        ],
      });
      await ctx.verify("the sessions are imported", [same("status", pick(answer.body, "result", "status"), "imported")], { critical: true });
      const read = await results(ctx, site, "hour");
      await ctx.verify("the window's edges", [
        same("sessions per step: all three enter and reach /plans, only the goal at exactly 60 minutes counts", read.steps.map((step) => step.sessions), [3, 3, 1]),
      ]);
    },
  },
];
