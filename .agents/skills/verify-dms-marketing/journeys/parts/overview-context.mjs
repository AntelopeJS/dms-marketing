import { list, mkt, num, pick, same } from "../../marketing.mjs";
import { collected, pageview } from "../../site.mjs";
import { history, period, shop } from "./overview-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */

const WEEK = period(6, 0);

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }[]} */
export const journeys = [
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
