import { mkt, num, pick, reads, same } from "../../../packages/dms-marketing/tests/journeys/marketing.mjs";
import { eventually } from "../../../packages/dms-marketing/tests/journeys/site.mjs";
import { history, shop } from "../../../packages/dms-marketing/tests/journeys/parts/overview-helpers.mjs";

/** @typedef {import("../../../packages/dms-marketing/tests/journeys/marketing.mjs").Ctx} Ctx */

/**
 * The saved settings once `accept` holds for them, or the last read after the wait.
 *
 * @param {Ctx} ctx The journey
 * @param {(body: unknown) => boolean} [accept] What the page's save must have written
 * @returns {Promise<unknown>} The saved settings
 */
async function settings(ctx, accept = () => true) {
  return (await eventually(() => mkt(ctx, "read the settings", "GET", "/settings"), (answer) => accept(answer.body))).body;
}

/** The Settings page in the browser (4.usage/8.settings.md). */
export const journeys = [
  {
    id: "the-settings-page-saves-sampling-confirms-a-retention-cut-and-pauses-collection",
    title: "the Settings page saves a sampling change, asks for a second save before a retention cut that deletes data, and pauses and resumes collection behind its confirmation",
    entryPoint: "/modules/marketing/settings",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await history(ctx, site, [{ visitor: "old", daysAgo: 40, minutes: [0], paths: ["/old"] }]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto("/modules/marketing/settings");
      await ctx.verify("the form starts from the defaults", [await reads(tab, /spinbutton "Heatmap sampling \(%\)": "10"/, { timeoutMs: 60_000 }), reads(tab, /spinbutton "Raw events \(days\)": "90"/)]);
      await tab.fill({ role: "spinbutton", name: "Heatmap sampling (%)" }, "25");
      await tab.press("Tab");
      await ctx.verify("a change offers Save changes", [reads(tab, /status: Unsaved changes · Heatmap sampling \(%\)\n- button "Discard"\n- button "Save changes"/)], { critical: true });
      await tab.click({ role: "button", name: "Save changes" });
      await ctx.verify("the sampling is saved", [same("heatmapSamplePercent", num(await settings(ctx, (body) => num(body, "heatmapSamplePercent") === 25), "heatmapSamplePercent"), 25)]);
      await tab.fill({ role: "spinbutton", name: "Raw events (days)" }, "20");
      await tab.fill({ role: "spinbutton", name: "Page snapshots (days)" }, "20");
      await tab.press("Tab");
      await tab.click({ role: "button", name: "Save changes" });
      await ctx.verify("a cut that deletes the 40-day-old events asks for a second save", [reads(tab, /Save again to confirm\. On the hour, the cleanup deletes the raw events older than this/), same("the retention is unchanged", num(await settings(ctx), "rawEventsRetentionDays"), 90)]);
      await tab.click({ role: "button", name: "Save changes" });
      const cut = await settings(ctx, (body) => num(body, "rawEventsRetentionDays") === 20);
      await ctx.verify("the second save applies the cut", [same("raw events and snapshots", [num(cut, "rawEventsRetentionDays"), num(cut, "snapshotRetentionDays")], [20, 20])]);
      await tab.click({ role: "button", name: "Pause collection…" });
      await ctx.verify("Pause collection asks first", [await tab.visible({ role: "button", name: "Pause collection", exact: true })], { critical: true });
      await tab.click({ role: "button", name: "Pause collection", exact: true });
      await ctx.verify("the confirmation pauses collection", [reads(tab, /button "Resume collection"/), same("trackerEnabled", pick(await settings(ctx, (body) => pick(body, "trackerEnabled") === false), "trackerEnabled"), false)]);
      await tab.click({ role: "button", name: "Resume collection" });
      await ctx.verify("Resume collection turns it back on", [reads(tab, /button "Pause collection…"/), same("trackerEnabled", pick(await settings(ctx, (body) => pick(body, "trackerEnabled") === true), "trackerEnabled"), true)]);
    },
  },
];
