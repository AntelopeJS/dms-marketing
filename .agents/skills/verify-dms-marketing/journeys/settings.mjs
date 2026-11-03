import { guarded } from "../guard.mjs";
import { check, list, mkt, num, pick, same } from "../marketing.mjs";
import { collected, createSite, pageview } from "../site.mjs";
import { DAY_MS, edit } from "../store.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */

const SETTINGS = "/settings";
const DEFAULTS = { trackerEnabled: true, rawEventsRetentionDays: 90, statisticsRetentionDays: 395, heatmapSamplePercent: 10, snapshotRetentionDays: 30 };

/**
 * @param {Ctx} ctx The journey
 * @param {string} label What is saved
 * @param {Record<string, unknown> | null} body The partial body
 * @returns {ReturnType<typeof mkt>} The answer
 */
function save(ctx, label, body) {
  return mkt(ctx, label, "PUT", SETTINGS, { body });
}

/**
 * @param {Awaited<ReturnType<typeof mkt>>} answer A refusal
 * @returns {string[]} The fields its issues name
 */
function fieldsOf(answer) {
  return list(answer.body).map((issue) => (Array.isArray(issue.path) ? issue.path.join(".") : ""));
}

/** The Settings page's routes (4.usage/8.settings.md, 3.configuration.md, 7.architecture/3.http-api.md). */
export const journeys = guarded([
  {
    id: "the-settings-start-from-the-configuration-defaults",
    title: "a deployment with no saved settings reads 90, 395 and 30 days, 10 % sampling and collection on, and At a glance draws them on a 760-day scale",
    entryPoint: "GET /api/marketing/settings, GET /api/marketing/settings/glance",
    async run(/** @type {Ctx} */ ctx) {
      const read = await mkt(ctx, "read the settings", "GET", SETTINGS);
      await ctx.verify("the defaults", [same("the settings", read.body, DEFAULTS)]);
      const meters = [];
      for (const item of ["raw", "statistics", "snapshots"]) meters.push(await mkt(ctx, `read the ${item} meter`, "GET", `${SETTINGS}/glance?item=${item}`));
      await ctx.verify("the meters share one 760-day scale", [
        same("values", meters.map((meter) => num(meter.body, "value")), [90, 395, 30]),
        same("scale", meters.map((meter) => num(meter.body, "max")), [760, 760, 760]),
      ]);
      await save(ctx, "raise the raw retention", { rawEventsRetentionDays: 120 });
      const after = await mkt(ctx, "read the raw meter again", "GET", `${SETTINGS}/glance?item=raw`);
      await ctx.verify("a save shows at once in At a glance", [same("raw meter", num(after.body, "value"), 120)]);
    },
  },
  {
    id: "values-out-of-bounds-are-refused-under-their-field-never-clamped",
    title: "every documented bound is refused just outside and saved on the bound, a decimal is rounded, an unknown key or a body that is not JSON is a 400",
    entryPoint: "PUT /api/marketing/settings",
    async run(/** @type {Ctx} */ ctx) {
      /** @type {[string, Record<string, unknown>, string][]} */
      const refused = [
        ["raw 0", { rawEventsRetentionDays: 0 }, "rawEventsRetentionDays"],
        ["raw 367", { rawEventsRetentionDays: 367 }, "rawEventsRetentionDays"],
        ["statistics 0", { statisticsRetentionDays: 0 }, "statisticsRetentionDays"],
        ["statistics 761", { statisticsRetentionDays: 761 }, "statisticsRetentionDays"],
        ["snapshots 0", { snapshotRetentionDays: 0 }, "snapshotRetentionDays"],
        ["snapshots 367", { snapshotRetentionDays: 367 }, "snapshotRetentionDays"],
        ["sampling -1", { heatmapSamplePercent: -1 }, "heatmapSamplePercent"],
        ["sampling 101", { heatmapSamplePercent: 101 }, "heatmapSamplePercent"],
      ];
      for (const [label, body, field] of refused) {
        const answer = await save(ctx, label, body);
        await ctx.verify(`${label} is refused under its field`, [same("status and field", [answer.status, fieldsOf(answer).includes(field)], [400, true])]);
      }
      const unknown = await save(ctx, "an unknown key", { foo: 1 });
      const notJson = await mkt(ctx, "a body that is not JSON", "PUT", SETTINGS, { body: "not json" });
      await ctx.verify("a key the form does not know and a body that is not JSON", [same("unknown key", unknown.status, 400), same("not JSON", notJson.status, 400)]);
      const accepted = await save(ctx, "the bounds", { statisticsRetentionDays: 760, rawEventsRetentionDays: 366, snapshotRetentionDays: 366, heatmapSamplePercent: 100 });
      const zero = await save(ctx, "sampling 0", { heatmapSamplePercent: 0 });
      const read = await mkt(ctx, "read the settings", "GET", SETTINGS);
      await ctx.verify("the bounds themselves save", [same("the top of every range", [accepted.status, zero.status, num(read.body, "statisticsRetentionDays"), num(read.body, "rawEventsRetentionDays"), num(read.body, "snapshotRetentionDays"), num(read.body, "heatmapSamplePercent")], [200, 200, 760, 366, 366, 0])]);
      await save(ctx, "a decimal", { heatmapSamplePercent: 33.6 });
      const rounded = await mkt(ctx, "read the rounded sampling", "GET", SETTINGS);
      await ctx.verify("a decimal is rounded", [same("sampling", num(rounded.body, "heatmapSamplePercent"), 34)]);
    },
  },
  {
    id: "retentions-keep-their-order",
    title: "a snapshot retention above the raw-event retention and a statistics retention below it are refused, at the edge and one day over",
    entryPoint: "PUT /api/marketing/settings",
    async run(/** @type {Ctx} */ ctx) {
      await save(ctx, "raw 100, snapshots 100, statistics 200", { rawEventsRetentionDays: 100, snapshotRetentionDays: 100, statisticsRetentionDays: 200 });
      const snapshotsOver = await save(ctx, "snapshots 101 with raw 100", { snapshotRetentionDays: 101 });
      const rawUnderSnapshots = await save(ctx, "raw 99 with snapshots 100", { rawEventsRetentionDays: 99 });
      const statisticsUnder = await save(ctx, "statistics 99 with raw 100", { statisticsRetentionDays: 99 });
      const statisticsEdge = await save(ctx, "statistics 100 with raw 100", { statisticsRetentionDays: 100 });
      const rawOverStatistics = await save(ctx, "raw 101 with statistics 100", { rawEventsRetentionDays: 101 });
      await ctx.verify("the order raw >= snapshots and statistics >= raw", [
        same("snapshots 101 over raw 100", [snapshotsOver.status, fieldsOf(snapshotsOver).length > 0], [400, true]),
        same("raw 99 under snapshots 100", rawUnderSnapshots.status, 400),
        same("statistics 99 under raw 100", statisticsUnder.status, 400),
        same("statistics equal to raw", statisticsEdge.status, 200),
        same("raw 101 over statistics 100", rawOverStatistics.status, 400),
      ]);
      const read = await mkt(ctx, "read the settings", "GET", SETTINGS);
      await ctx.verify("a refusal changes nothing", [same("retentions", [num(read.body, "rawEventsRetentionDays"), num(read.body, "snapshotRetentionDays"), num(read.body, "statisticsRetentionDays")], [100, 100, 100])]);
    },
  },
  {
    id: "a-save-merges-and-null-or-the-default-follows-the-configuration",
    title: "a field left out keeps its value, null or the configuration default goes back to following it, and the master switch is a field of its own",
    entryPoint: "PUT /api/marketing/settings",
    async run(/** @type {Ctx} */ ctx) {
      await save(ctx, "raw 120 and sampling 50", { rawEventsRetentionDays: 120, heatmapSamplePercent: 50 });
      await save(ctx, "statistics only", { statisticsRetentionDays: 500 });
      const merged = await mkt(ctx, "read after a partial save", "GET", SETTINGS);
      await ctx.verify("a partial save keeps the other fields", [same("settings", [num(merged.body, "rawEventsRetentionDays"), num(merged.body, "heatmapSamplePercent"), num(merged.body, "statisticsRetentionDays")], [120, 50, 500])]);
      await save(ctx, "raw back to null", { rawEventsRetentionDays: null });
      await save(ctx, "sampling to the default itself", { heatmapSamplePercent: 10 });
      const reset = await mkt(ctx, "read after the resets", "GET", SETTINGS);
      await ctx.verify("null and the default itself follow the configuration again", [same("settings", [num(reset.body, "rawEventsRetentionDays"), num(reset.body, "heatmapSamplePercent"), num(reset.body, "statisticsRetentionDays")], [90, 10, 500])]);
      const off = await save(ctx, "collection off in the form", { trackerEnabled: false });
      const state = await mkt(ctx, "read the collection state", "GET", `${SETTINGS}/collection`);
      await ctx.verify("the master switch is a setting", [same("saved and off", [off.status, pick(state.body, "enabled")], [200, false])]);
      await mkt(ctx, "resume", "POST", `${SETTINGS}/collection`, { body: { enabled: true } });
      const back = await mkt(ctx, "read the settings", "GET", SETTINGS);
      await ctx.verify("resume turns it on again and leaves the retentions", [same("tracker and statistics", [pick(back.body, "trackerEnabled"), num(back.body, "statisticsRetentionDays")], [true, 500])]);
    },
  },
  {
    id: "a-retention-cut-that-deletes-data-asks-before-it-applies",
    title: "the first save of a cut that would delete stored events is a 409 that says what goes; saving it again applies it; a cut that deletes nothing saves at once",
    entryPoint: "PUT /api/marketing/settings",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await createSite(ctx);
      await collected(ctx, "one pageview", shop, [pageview(shop, "/old")]);
      const aged = await edit(ctx, "marketing_events", { websiteId: shop.id }, { timestamp: new Date(Date.now() - 10 * DAY_MS), day: 0 });
      await ctx.verify("the event is 10 days old", [same("rows aged", aged, 1)], { critical: true });
      const nothing = await save(ctx, "raw 30, snapshots 30 (deletes nothing)", { rawEventsRetentionDays: 30 });
      const first = await save(ctx, "raw 5 and snapshots 5 (deletes the event)", { rawEventsRetentionDays: 5, snapshotRetentionDays: 5 });
      const second = await save(ctx, "the same cut again", { rawEventsRetentionDays: 5, snapshotRetentionDays: 5 });
      const read = await mkt(ctx, "read the settings", "GET", SETTINGS);
      await ctx.verify("the cut asks once", [
        same("a cut that deletes nothing saves", nothing.status, 200),
        same("the first destructive save is refused with a 409", first.status, 409),
        check("it names the field", JSON.stringify(first.body).includes("rawEventsRetentionDays"), first.body),
        same("saving again applies it", second.status, 200),
        same("the stored value", num(read.body, "rawEventsRetentionDays"), 5),
      ]);
    },
  },
]);
