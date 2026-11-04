import { check, list, mkt, num, pick, same } from "../../marketing.mjs";
import { collected, pageview } from "../../site.mjs";
import { edit } from "../../store.mjs";
import { history, period, shop } from "./overview-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */

const WEEK = period(6, 0);

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }[]} */
export const journeys = [
  {
    id: "a-site-reads-live-for-5-minutes-after-its-last-event-then-last-event",
    title: "the context bar reads Live while the last event is under 5 minutes old (4 min 30 s) and Last event without Live after it (5 min 30 s)",
    entryPoint: "/modules/marketing/overview",
    async run(ctx) {
      const tab = await ctx.tab();
      await tab.signIn("admin");
      for (const [seconds, live] of /** @type {[number, boolean][]} */ ([[270, true], [330, false]])) {
        const site = await shop(ctx);
        await collected(ctx, "a pageview", site, [pageview(site, "/a")]);
        const at = new Date(Date.now() - seconds * 1000);
        await edit(ctx, "marketing_sessions", { websiteId: site.id }, { lastSeenAt: at, startedAt: at });
        await edit(ctx, "marketing_events", { websiteId: site.id }, { timestamp: at });
        await tab.goto(`/modules/marketing/overview?website=${site.id}`);
        const statusLine = async () => {
          const deadline = Date.now() + 60_000;
          let line = "";
          while (Date.now() < deadline && !/last event/i.test(line)) {
            line = await tab.page.evaluate(() => [...document.querySelectorAll("[role=status]")].map((node) => `${node.getAttribute("aria-label") ?? ""} ${node.textContent ?? ""}`).join(" | "));
            if (!/last event/i.test(line)) await new Promise((resolve) => setTimeout(resolve, 500));
          }
          return line;
        };
        const line = await statusLine();
        const preset = await tab.page.evaluate(() => [...document.querySelectorAll("[role=radio]")].filter((node) => node.getAttribute("aria-checked") === "true" || node.getAttribute("data-state") === "checked").map((node) => node.textContent ?? "").join("|"));
        if (live) await ctx.verify("the period opens on the last 30 days, the default", [check("the checked preset", /30D/.test(preset), preset)]);
        await ctx.verify(`${seconds} seconds after the last event`, [
          check("the bar names the last event", /last event/i.test(line), line.slice(0, 200)),
          same("Live or not", /Live · last event/.test(line), live),
        ]);
      }
    },
  },
  {
    id: "a-block-resolves-its-website-from-the-url-then-the-pick-then-the-latest",
    title: "the website query wins over the member's pick, the pick wins over the most recently active site while it still belongs to the tenant, and a tenant with no website answers 404",
    entryPoint: "GET /api/marketing/blocks/kpi, PUT /api/marketing/context",
    async run(ctx) {
      const none = await mkt(ctx, "a block with no website in the tenant", "GET", `/blocks/kpi?metric=pageviews&${WEEK}`);
      await ctx.verify("no website", [same("status", none.status, 404)]);
      const older = await shop(ctx);
      const newer = await shop(ctx);
      await collected(ctx, "two pageviews on the older site", older, [pageview(older, "/a"), pageview(older, "/b")]);
      await collected(ctx, "one pageview on the newer site", newer, [pageview(newer, "/a")]);
      const read = async (/** @type {string} */ website) => num((await mkt(ctx, "read the pageviews", "GET", `/blocks/kpi?metric=pageviews&${website}${WEEK}`)).body, "value");
      await ctx.verify("with no pick the most recently active site", [same("pageviews", await read(""), 1)]);
      await mkt(ctx, "pick the older site", "PUT", "/context", { body: { website: older.id } });
      await ctx.verify("the pick, then the query over the pick", [same("the pick", await read(""), 2), same("the query", await read(`website=${newer.id}&`), 1)]);
      await mkt(ctx, "delete the picked site", "DELETE", `/websites/${older.id}`);
      await ctx.verify("a pick that no longer belongs to the tenant falls back to the latest site", [same("pageviews", await read(""), 1), same("selected site", pick((await mkt(ctx, "read the context", "GET", "/context")).body, "selectedId"), newer.id)]);
    },
  },
  {
    id: "an-imported-site-turns-live-with-the-first-collected-hit",
    title: "a site that only holds imported history reads imported; its first collected hit turns it live; the context bar lists waiting, imported and paused sites with their state",
    entryPoint: "GET /api/marketing/context",
    async run(ctx) {
      const waiting = await shop(ctx);
      const imported = await shop(ctx);
      const paused = await shop(ctx);
      await history(ctx, imported, [{ visitor: "h", daysAgo: 3, minutes: [0, 1], paths: ["/a", "/b"] }]);
      await mkt(ctx, "pause a site", "PUT", `/websites/${paused.id}`, { body: { trackingEnabled: false } });
      const states = async () => Object.fromEntries(list((await mkt(ctx, "read the context", "GET", "/context")).body, "websites").map((site) => [String(site.id), site.state]));
      const before = await states();
      await ctx.verify("the four states", [same("waiting, imported, paused", [before[waiting.id], before[imported.id], before[paused.id]], ["waiting", "imported", "paused"])]);
      await collected(ctx, "the first collected hit", imported, [pageview(imported, "/live")]);
      const after = await states();
      await ctx.verify("live once a hit arrived", [same("state", after[imported.id], "live")]);
    },
  },
];
