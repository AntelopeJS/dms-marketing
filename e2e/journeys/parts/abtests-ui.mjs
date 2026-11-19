import { check, parseJson, pick, raw, reads, same } from "../../../packages/dms-marketing/tests/journeys/marketing.mjs";
import { split } from "../../../packages/dms-marketing/tests/journeys/parts/abtests-helpers.mjs";
import { shop } from "../../../packages/dms-marketing/tests/journeys/parts/funnels-helpers.mjs";

/** @typedef {import("../../../packages/dms-marketing/tests/journeys/marketing.mjs").Ctx} Ctx */

/** The A/B report in the browser (4.usage/6.ab-tests.md). */
export const journeys = [
  {
    id: "the-ab-report-reads-each-arm-and-stops-the-test-behind-a-confirmation",
    title: "the A/B report of a running split shows each arm's rate, the lift, the p-value and the split check, and Stop test asks first and serves the control to everyone",
    entryPoint: "/modules/marketing/funnel",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      const id = await split(ctx, site, { arms: { control: { n: 30, conv: 5 }, b: { n: 30, conv: 9 } } });
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto(`/modules/marketing/funnel?id=${id}&website=${site.id}`);
      await ctx.verify("the report renders its verdict", [await reads(tab, /heading "No difference you can trust yet"/, { timeoutMs: 60_000 })], { critical: true });
      await ctx.verify("the report reads both arms", [
        reads(tab, /listitem: A control 16\.67%\n\s*- listitem: B b 30\.00%/),
        reads(tab, /\+80\.0% B vs A at the goal/),
        reads(tab, /0\.222 two-sided z-test/),
        reads(tab, /Split check passed: 50\.0 \/ 50\.0 observed for 50 \/ 50 configured/),
      ]);
      await tab.click({ role: "button", name: "Stop test" });
      await ctx.verify("Stop test asks first", [await tab.visible({ role: "heading", name: "Stop this test?" })], { critical: true });
      await tab.click({ role: "button", name: "Stop test", within: { role: "dialog", name: "Stop this test?" } });
      await ctx.verify("the report turns to the stopped test", [await reads(tab, /Code to remove/)], { critical: true });
      const served = await raw(ctx, "the assignment script a visitor loads", { path: `/api/marketing/experiments.js?website=${site.id}`, headers: { "user-agent": "Mozilla/5.0 Chrome/130 stopped-visitor" } });
      const script = /__dmsMarketingAssignments=(\{.*\})/.exec(served.text)?.[1];
      await ctx.verify("the stopped test serves no arm", [check("the script carries its assignments", script !== undefined, served.text.slice(0, 300)), same("hero", pick(parseJson(script ?? "null"), "hero"), undefined)]);
    },
  },
];
