import { check, list, mkt, reads } from "../../marketing.mjs";
import { click, collected, createSite, eventually, pageview } from "../../site.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */

const CLICK = { x: 0.5, y: 0.2, docX: 0.5, docY: 0.1 };

/** The Pages & heatmaps page in the browser (4.usage/3.pages-and-heatmaps.md). */
export const journeys = [
  {
    id: "the-pages-page-lists-sorts-and-opens-a-page",
    title: "Pages & heatmaps lists every path with its views and clicks, the Clicks sort reorders it, and a path opens its header of views and clicks over the snapshot notice",
    entryPoint: "/modules/marketing/pages",
    async run(/** @type {Ctx} */ ctx) {
      const site = await createSite(ctx);
      await ctx.verify("the website exists", [check("POST /websites answers its id", site.id !== "", site.answer.body)], { critical: true });
      await collected(ctx, "/blog is read three times without a click", site, [pageview(site, "/blog"), pageview(site, "/blog"), pageview(site, "/blog")]);
      await collected(ctx, "/pricing is read once and clicked twice", site, [pageview(site, "/pricing"), click(site, "/pricing", CLICK), click(site, "/pricing", CLICK)]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto(`/modules/marketing/pages?website=${site.id}`);
      await ctx.verify("the list orders the paths by views", [await reads(tab, /- paragraph: 2 pages\n/, { timeoutMs: 60_000 }), reads(tab, /button "\/blog 3 0 clicks"[\s\S]*button "\/pricing 1 2 clicks"/)]);
      await tab.click({ role: "radio", name: "Clicks", within: { role: "radiogroup", name: "Sort by" } });
      await ctx.verify("the Clicks sort puts /pricing first", [reads(tab, /button "\/pricing 2 1 view"[\s\S]*button "\/blog 0 3 views"/)]);
      await ctx.verify("the page with clicks opens first", [reads(tab, /- text: \/pricing\n[\s\S]*- paragraph: 1 view 2 clicks/)]);
      await tab.click({ role: "button", name: "/blog 0 3 views" });
      await ctx.verify("a path opens its header of views and clicks", [reads(tab, /- text: \/blog\n[\s\S]*- paragraph: 3 views 0 clicks/), tab.visible({ role: "button", name: "Enable page snapshots" })]);
      await tab.click({ role: "button", name: "Enable page snapshots" });
      const sites = await eventually(
        () => mkt(ctx, "read the websites", "GET", "/websites"),
        (answer) => list(answer.body).some((row) => row._id === site.id && row.snapshotsEnabled === true),
      );
      await ctx.verify("Enable page snapshots turns snapshots on for the site", [check("snapshotsEnabled", list(sites.body).find((row) => row._id === site.id)?.snapshotsEnabled === true, sites.body)]);
    },
  },
];
