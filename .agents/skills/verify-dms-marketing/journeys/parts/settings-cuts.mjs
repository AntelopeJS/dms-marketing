import { fixture, mkt, pick, same, text } from "../../marketing.mjs";
import { collected, createSite, pageview } from "../../site.mjs";
import { DAY_MS, drop, edit, rows } from "../../store.mjs";
import { history, shop } from "./overview-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */

const MINUTE_MS = 60_000;

/**
 * @param {Ctx} ctx The journey
 * @param {Record<string, unknown>} body The partial settings
 * @returns {ReturnType<typeof mkt>} The answer
 */
function save(ctx, body) {
  return mkt(ctx, `save ${JSON.stringify(body)}`, "PUT", "/settings", { body });
}

/**
 * What a refused cut says.
 *
 * @param {Awaited<ReturnType<typeof mkt>>} answer A save
 * @returns {unknown[]} Status, field, kind of row and how many
 */
function conflict(answer) {
  return [answer.status, text(answer.body, "field"), text(answer.body, "message").replace(/^.*\./, ""), pick(answer.body, "params", "deleted")];
}

/** @type {{ id: string, title: string, entryPoint: string, run: (ctx: Ctx) => Promise<void> }[]} */
export const journeys = [
  {
    id: "a-raw-events-cut-says-how-many-events-it-deletes",
    title: "lowering the raw-event retention answers 409 on rawEventsRetentionDays naming raw_events and the exact count older than the new retention; events inside the new retention are not counted",
    entryPoint: "PUT /api/marketing/settings",
    async run(ctx) {
      const site = await createSite(ctx);
      await collected(ctx, "five events", site, [pageview(site, "/a"), pageview(site, "/b"), pageview(site, "/c"), pageview(site, "/d"), pageview(site, "/e")]);
      const events = await rows(ctx, "marketing_events", { websiteId: site.id });
      const [first, second, third] = events.map((event) => event._id);
      await edit(ctx, "marketing_events", { _id: { $in: [first, second, third] } }, { timestamp: new Date(Date.now() - 10 * DAY_MS) });
      await edit(ctx, "marketing_events", { _id: { $in: events.slice(3).map((event) => event._id) } }, { timestamp: new Date(Date.now() - 3 * DAY_MS) });
      const cut = await save(ctx, { rawEventsRetentionDays: 5, snapshotRetentionDays: 5 });
      await ctx.verify("three of five events are older than 5 days", [same("status, field, kind, count", conflict(cut), [409, "rawEventsRetentionDays", "raw_events", 3])]);
      const again = await save(ctx, { rawEventsRetentionDays: 5, snapshotRetentionDays: 5 });
      await ctx.verify("sent again it applies", [same("status", again.status, 200)]);
      const gentle = await save(ctx, { rawEventsRetentionDays: 2, snapshotRetentionDays: 2 });
      await ctx.verify("every event is older than 2 days", [same("status, field, kind, count", conflict(gentle), [409, "rawEventsRetentionDays", "raw_events", 5])]);
    },
  },
  {
    id: "a-statistics-cut-counts-sessions-then-rollups-and-a-snapshot-cut-counts-captures",
    title: "a statistics cut names sessions with their count, or daily rollups when no session is that old; a snapshot-retention cut names snapshots with their count",
    entryPoint: "PUT /api/marketing/settings",
    async run(ctx) {
      const site = await shop(ctx);
      await history(ctx, site, [{ visitor: "a", daysAgo: 100, minutes: [0, 1], paths: ["/a", "/b"] }, { visitor: "b", daysAgo: 100, minutes: [5], paths: ["/a"] }, { visitor: "c", daysAgo: 100, minutes: [9], paths: ["/a"] }]);
      const sessions = await save(ctx, { statisticsRetentionDays: 95 });
      await ctx.verify("three sessions are older than 95 days", [same("status, field, kind, count", conflict(sessions), [409, "statisticsRetentionDays", "sessions", 3])]);
      await drop(ctx, "marketing_sessions", {});
      const rollups = await save(ctx, { statisticsRetentionDays: 94 });
      await ctx.verify("no session left: the rollup rows of the old day", [same("status, field, kind, count", conflict(rollups), [409, "statisticsRetentionDays", "rollups", 1])]);
      const shipped = await fixture(ctx, "declare a website with snapshots", "POST", "/website", { tenantId: "default", id: "snap-site", name: "Snap", domain: "snap.example.com", snapshotsEnabled: true });
      await fixture(ctx, "declare a snapshot", "POST", "/snapshot", { tenantId: "default", websiteId: "snap-site", url: "https://snap.example.com/p", html: "<body>x</body>", viewport: { width: 1280, height: 800 }, document: { width: 1280, height: 800 } });
      await fixture(ctx, "declare a second snapshot", "POST", "/snapshot", { tenantId: "default", websiteId: "snap-site", url: "https://snap.example.com/q", html: "<body>y</body>", viewport: { width: 1280, height: 800 }, document: { width: 1280, height: 800 } });
      await ctx.verify("the snapshots are declared", [same("website", pick(shipped.body, "result", "status"), "created")], { critical: true });
      await edit(ctx, "page_snapshots", { websiteId: "snap-site" }, { capturedAt: new Date(Date.now() - 25 * DAY_MS) });
      const snapshots = await save(ctx, { snapshotRetentionDays: 20 });
      await ctx.verify("two captures are older than 20 days", [same("status, field, kind, count", conflict(snapshots), [409, "snapshotRetentionDays", "snapshots", 2])]);
      const untouched = await save(ctx, { snapshotRetentionDays: 26 });
      await ctx.verify("a snapshot retention that keeps both captures saves at once", [same("status", untouched.status, 200)]);
    },
  },
  {
    id: "a-warned-cut-applies-when-sent-again-within-ten-minutes",
    title: "after the 409 the same cut is saved 9 minutes later (a real wait)",
    entryPoint: "PUT /api/marketing/settings",
    async run(ctx) {
      const site = await createSite(ctx);
      await collected(ctx, "one event", site, [pageview(site, "/a")]);
      await edit(ctx, "marketing_events", { websiteId: site.id }, { timestamp: new Date(Date.now() - 10 * DAY_MS) });
      const first = await save(ctx, { rawEventsRetentionDays: 5, snapshotRetentionDays: 5 });
      await new Promise((resolve) => setTimeout(resolve, 9 * MINUTE_MS));
      const inside = await save(ctx, { rawEventsRetentionDays: 5, snapshotRetentionDays: 5 });
      await ctx.verify("9 minutes is inside the window", [same("first, second", [first.status, inside.status], [409, 200])]);
    },
  },
  {
    id: "a-warned-cut-is-asked-again-after-ten-minutes",
    title: "after the 409 the same cut is answered 409 again 10 minutes and 30 seconds later, and applies when sent right after",
    entryPoint: "PUT /api/marketing/settings",
    async run(ctx) {
      const site = await createSite(ctx);
      await collected(ctx, "one event", site, [pageview(site, "/a")]);
      await edit(ctx, "marketing_events", { websiteId: site.id }, { timestamp: new Date(Date.now() - 10 * DAY_MS) });
      const first = await save(ctx, { rawEventsRetentionDays: 5, snapshotRetentionDays: 5 });
      await new Promise((resolve) => setTimeout(resolve, 10 * MINUTE_MS + 30_000));
      const late = await save(ctx, { rawEventsRetentionDays: 5, snapshotRetentionDays: 5 });
      const confirmed = await save(ctx, { rawEventsRetentionDays: 5, snapshotRetentionDays: 5 });
      await ctx.verify("the window is ten minutes", [same("first, late, confirmed", [first.status, late.status, confirmed.status], [409, 409, 200])]);
    },
  },
];
