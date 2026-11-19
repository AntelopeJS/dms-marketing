import { check, same } from "../../../packages/dms-marketing/tests/journeys/marketing.mjs";
import { collected, pageview } from "../../../packages/dms-marketing/tests/journeys/site.mjs";
import { edit } from "../../../packages/dms-marketing/tests/journeys/store.mjs";
import { shop } from "../../../packages/dms-marketing/tests/journeys/parts/overview-helpers.mjs";

/** @typedef {import("../../../packages/dms-marketing/tests/journeys/marketing.mjs").Ctx} Ctx */

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }[]} */
export const journeys = [
  {
    id: "a-site-reads-live-for-5-minutes-after-its-last-event-then-last-event",
    title: "the context bar reads Live while the last event is under 5 minutes old (4 min 30 s) and Last event without Live after it (5 min 30 s)",
    entryPoint: "/modules/marketing/overview",
    async run(ctx) {
      const tab = await ctx.tab();
      await tab.signIn("admin");
      for (const { seconds, live } of [{ seconds: 270, live: true }, { seconds: 330, live: false }]) {
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
];
