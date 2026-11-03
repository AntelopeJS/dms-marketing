import { check, clickUntil, list, mkt, same } from "../../marketing.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */

/** The Websites page in the browser (4.usage/7.websites.md). */
export const journeys = [
  {
    id: "the-websites-page-adds-lists-pauses-and-resumes-a-site",
    title: "Add a website creates the site and opens its install guide; the card shows its state; the settings modal pauses and Resume tracking resumes it",
    entryPoint: "/modules/marketing/websites, /modules/marketing/install",
    async run(/** @type {Ctx} */ ctx) {
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/marketing/websites");
      await ctx.verify("a workspace with no website shows the first-run screen", [tab.shows(/Add a website/, { timeoutMs: 60_000 })]);
      await ctx.verify("the Add a website modal opens", [clickUntil(tab, { role: "button", name: "Add a website" }, { role: "textbox", name: "Name" })], { critical: true });
      await tab.fill({ role: "textbox", name: "Name" }, "Browser shop");
      await tab.fill({ role: "textbox", name: "Domain" }, "browser-shop.example.com");
      await tab.click({ role: "button", name: "Add website" });
      await ctx.verify("the install guide opens on the new site", [tab.at(/\/modules\/marketing\/install$/, { timeoutMs: 60_000 }), tab.shows(/data-website-id/, { timeoutMs: 60_000 })]);
      const created = list((await mkt(ctx, "list the websites", "GET", "/websites")).body);
      const site = created[0];
      await ctx.verify("the site exists with the typed values", [same("one site", [created.length, site?.name, site?.domain], [1, "Browser shop", "browser-shop.example.com"]), check("the guide embeds the site id", String(await tab.page.content()).includes(String(site?._id)), site?._id)]);
      await tab.goto("/modules/marketing/websites");
      await ctx.verify("the card names the site, its domain and its state", [tab.shows(/Browser shop\s+browser-shop\.example\.com/, { timeoutMs: 60_000 }), tab.shows(/Waiting for the first pageview|Waiting/i)]);
      await ctx.verify("the settings modal opens", [clickUntil(tab, { role: "button", name: "Settings of Browser shop" }, { role: "switch", name: "Collect data" })], { critical: true });
      await tab.click({ role: "switch", name: "Collect data" });
      await tab.click({ role: "button", name: "Save" });
      const paused = await mkt(ctx, "read the site", "GET", "/websites");
      await ctx.verify("the switch pauses the site", [same("tracking", list(paused.body)[0]?.trackingEnabled, false)]);
      await tab.goto("/modules/marketing/websites");
      await ctx.verify("a paused site offers Resume tracking", [tab.shows(/Paused/i, { timeoutMs: 60_000 })]);
      await tab.click({ role: "button", name: "Resume tracking" });
      const resumed = await mkt(ctx, "read the site", "GET", "/websites");
      await ctx.verify("Resume tracking resumes it", [same("tracking", list(resumed.body)[0]?.trackingEnabled, true)]);
    },
  },
];
