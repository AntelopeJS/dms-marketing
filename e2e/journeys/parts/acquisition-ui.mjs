import { reads } from "../../../packages/dms-marketing/tests/journeys/marketing.mjs";
import { shop, visit } from "../../../packages/dms-marketing/tests/journeys/parts/acquisition-helpers.mjs";

/** @typedef {import("../../../packages/dms-marketing/tests/journeys/marketing.mjs").Ctx} Ctx */

/** The Acquisition page in the browser (4.usage/2.acquisition.md). */
export const journeys = [
  {
    id: "the-acquisition-page-splits-the-channels-and-filters-the-campaigns-by-channel",
    title: "the Acquisition page lists each channel with its sessions, the UTM campaigns table holds one row per tagged triple, and a channel tab keeps only its campaigns",
    entryPoint: "/modules/marketing/acquisition",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await visit(ctx, site, [
        { query: "?utm_source=newsletter&utm_medium=email&utm_campaign=spring" },
        { query: "?utm_source=google&utm_medium=cpc&utm_campaign=brand" },
        { query: "?utm_source=google&utm_medium=cpc&utm_campaign=brand" },
        { referrer: "https://www.bing.com/" },
        {},
      ]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto(`/modules/marketing/acquisition?website=${site.id}`);
      await ctx.verify("the page renders the channels", [await reads(tab, /- paragraph: Channels · 5 sessions\n/, { timeoutMs: 60_000 })], { critical: true });
      await ctx.verify("the channels table counts each channel's sessions", [
        tab.visible({ role: "row", name: "Show the Paid campaigns 2 40.0%" }),
        tab.visible({ role: "row", name: "Show the Email campaigns 1 20.0%" }),
        tab.visible({ role: "row", name: "Show the Organic search campaigns 1 20.0%" }),
        tab.visible({ role: "row", name: "Show the Direct campaigns 1 20.0%" }),
      ]);
      await ctx.verify("the campaigns table holds the two tagged campaigns", [reads(tab, /- text: 3 tagged sessions · 60% of traffic\n/), reads(tab, /heading "UTM campaigns 2"/), reads(tab, /- row "brand google cpc Paid 2 40%[^"]*":[\s\S]*- row "spring newsletter email Email 1 20%/)]);
      await tab.click({ role: "button", name: "Email 1", exact: true });
      await ctx.verify("the Email tab keeps the newsletter campaign alone", [reads(tab, /heading "UTM campaigns 1"/), reads(tab, /^(?![\s\S]*- row "brand)[\s\S]*- row "spring newsletter email Email 1 20%/)]);
    },
  },
];
