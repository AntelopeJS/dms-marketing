import { reads } from "../../../packages/dms-marketing/tests/journeys/marketing.mjs";
import { collected, pageview } from "../../../packages/dms-marketing/tests/journeys/site.mjs";
import { shop } from "../../../packages/dms-marketing/tests/journeys/parts/overview-helpers.mjs";

/** @typedef {import("../../../packages/dms-marketing/tests/journeys/marketing.mjs").Ctx} Ctx */

/** The Overview page in the browser (4.usage/1.overview.md). */
export const journeys = [
  {
    id: "the-overview-page-shows-the-kpis-and-the-top-pages-and-opens-a-page",
    tag: "@smoke",
    title: "the Overview page shows the pageviews, sessions and new visitors collected, lists the top pages by views, and a top page opens its row of Pages & heatmaps",
    entryPoint: "/modules/marketing/overview",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await collected(ctx, "a visitor reads /pricing twice", site, [pageview(site, "/pricing"), pageview(site, "/pricing")]);
      await collected(ctx, "another visitor reads /docs", site, [pageview(site, "/docs")], { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130.0 other-visitor" });
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto(`/modules/marketing/overview?website=${site.id}`);
      await ctx.verify("the page renders the KPI cards", [await reads(tab, /- paragraph: Pageviews\n- paragraph: "3"\n/, { timeoutMs: 60_000 })], { critical: true });
      await ctx.verify("the KPI cards count what was collected", [
        reads(tab, /- paragraph: Sessions\n- paragraph: "2"\n/),
        reads(tab, /- paragraph: New visitors\n- paragraph: "2"\n/),
      ]);
      await ctx.verify("the top pages rank /pricing before /docs", [tab.visible({ role: "link", name: "01 /pricing 2" }), tab.visible({ role: "link", name: "02 /docs 1" })]);
      await tab.click({ role: "link", name: "02 /docs 1" });
      await ctx.verify("a top page opens its own page in Pages & heatmaps", [tab.at(/\/modules\/marketing\/pages$/, { timeoutMs: 60_000 }), reads(tab, /- paragraph:\n\s+- text: \/docs\n[\s\S]*- paragraph: 1 view 0 clicks/, { timeoutMs: 60_000 })]);
    },
  },
];
