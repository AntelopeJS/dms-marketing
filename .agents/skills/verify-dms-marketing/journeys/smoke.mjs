import { guarded } from "../guard.mjs";
import { check } from "../marketing.mjs";
import { collected, createSite, eventually, overview, pageview } from "../site.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */

/** The README's quick start: add a website, track a visit, read it back in Marketing. */
export const journeys = guarded([
  {
    id: "smoke",
    title: "an owner adds a website, a visit reaches the collector and the Overview counts its pageview",
    entryPoint: "/modules/marketing/websites, POST /api/marketing/collect, /modules/marketing/overview",
    async run(/** @type {Ctx} */ ctx) {
      const site = await createSite(ctx, { name: "Smoke shop" });
      await ctx.verify("the website is created", [check("POST /websites answers its id", site.answer.status === 200 && site.id !== "", site.answer.body)], { critical: true });
      await collected(ctx, "a visit to /pricing is collected", site, [pageview(site, "/pricing", { title: "Pricing" })]);
      const read = await eventually(() => overview(ctx, site), (answer) => JSON.stringify(answer.body).includes("pricing"));
      await ctx.verify("the overview counts the pageview", [check("the overview read answers 200", read.status === 200, read.status), check("it mentions /pricing", JSON.stringify(read.body).includes("/pricing"), JSON.stringify(read.body).slice(0, 300))]);
    },
  },
]);
