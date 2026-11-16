import { collect, createSite, pageview } from "../../site.mjs";
import { check, same } from "../../marketing.mjs";
import { edit } from "../../store.mjs";
import { storedSessions } from "./collect-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */

const MINUTE_MS = 60_000;

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }[]} */
export const journeys = [
  {
    id: "the-default-session-idle-timeout-is-30-minutes",
    title: "with no configuration, a visitor back after 29 minutes is in the same session and after 31 minutes in a new one",
    entryPoint: "POST /api/marketing/collect",
    async run(ctx) {
      const site = await createSite(ctx);
      await ctx.verify("the website exists", [check("created", site.id !== "", site.answer.body)], { critical: true });
      for (const idle of [29, 31]) {
        const ua = `Mozilla/5.0 Chrome/130 idle-${idle}`;
        const first = await collect(ctx, `first visit of the ${idle}-minute visitor`, site, [pageview(site, `/first-${idle}`)], { ua });
        await ctx.verify(`${idle}: the first visit opens a session`, [same("accepted", first.accepted, 1)], { critical: true });
        const before = (await storedSessions(ctx, site)).length;
        const stale = new Date(Date.now() - idle * MINUTE_MS);
        await edit(ctx, "marketing_sessions", { entryUrl: `/first-${idle}` }, { lastSeenAt: stale, startedAt: stale });
        await ctx.restartBackend();
        const again = await collect(ctx, `second visit after ${idle} minutes`, site, [pageview(site, `/second-${idle}`)], { ua });
        await ctx.verify(`${idle} minutes of silence`, [same("accepted", again.accepted, 1), same("sessions added by the second visit", (await storedSessions(ctx, site)).length - before, idle < 30 ? 0 : 1)]);
      }
    },
  },
];
