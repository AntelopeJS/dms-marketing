import { guarded } from "../guard.mjs";
import { check, list, mkt, raw, same, text } from "../marketing.mjs";
import { collect, collected, createSite, pageview, withConfig } from "../site.mjs";
import { rows } from "../store.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */

const DAY_MS = 24 * 60 * 60 * 1000;
const DASHBOARD = "dashboard.example.org";

/**
 * Provisions the dashboard's own website the way the dashboard's tag does: a signed-in member posts from the
 * dashboard's origin.
 *
 * @param {Ctx} ctx The journey
 * @param {string} [origin] The Origin header
 * @returns {Promise<Awaited<ReturnType<typeof raw>>>} The answer
 */
function provision(ctx, origin = `https://${DASHBOARD}`) {
  return raw(ctx, `provision the dashboard website from ${origin}`, { path: "/api/marketing/dashboard-tracking", method: "POST", headers: { origin }, as: "admin" });
}

/** The module options (3.configuration.md). */
export const journeys = guarded([
  {
    id: "retention-and-sampling-options-set-what-settings-start-from",
    title: "rawEventsRetention, statisticsRetention, snapshotRetention and heatmapSampleRate set the defaults the Settings page shows and the tracker serves",
    entryPoint: "antelope.config.ts, GET /api/marketing/settings, GET /api/marketing/tracker.js",
    async run(/** @type {Ctx} */ ctx) {
      await withConfig(ctx, { rawEventsRetention: 10 * DAY_MS, statisticsRetention: 20 * DAY_MS, snapshotRetention: 5 * DAY_MS, heatmapSampleRate: 0.5 }, async () => {
        const settings = await mkt(ctx, "read the settings", "GET", "/settings");
        const script = await raw(ctx, "the tracker", { path: "/api/marketing/tracker.js" });
        await ctx.verify("the options are the defaults", [
          same("settings", settings.body, { trackerEnabled: true, rawEventsRetentionDays: 10, statisticsRetentionDays: 20, snapshotRetentionDays: 5, heatmapSamplePercent: 50 }),
          check("the tracker serves the configured rate", script.text.includes('"heatmapSampleRate":0.5') && script.text.includes('"paused":false'), script.text.slice(0, 100)),
        ]);
      });
    },
  },
  {
    id: "the-visitor-hash-secret-feeds-the-visitor-identity",
    title: "an explicit visitorHashSecret changes the visitor id of the same browser, the same secret gives the same id after a restart, and the generated secret is stable across restarts",
    entryPoint: "antelope.config.ts visitorHashSecret",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await createSite(ctx);
      /** @type {Record<string, string>} */
      const seen = {};
      const visit = async (/** @type {string} */ label) => {
        await collect(ctx, `visit under ${label}`, shop, [pageview(shop, `/${label}`)]);
        const events = (await rows(ctx, "marketing_events", { websiteId: shop.id, url: `/${label}` }));
        seen[label] = String(events[0]?.visitorId);
      };
      await visit("generated-1");
      await ctx.restartBackend();
      await visit("generated-2");
      await withConfig(ctx, { visitorHashSecret: "secret-one" }, () => visit("one-1"));
      await withConfig(ctx, { visitorHashSecret: "secret-two" }, () => visit("two-1"));
      await withConfig(ctx, { visitorHashSecret: "secret-one" }, () => visit("one-2"));
      await ctx.verify("the identity", [
        same("the generated secret is kept across a restart", seen["generated-1"], seen["generated-2"]),
        check("an explicit secret changes the id", seen["one-1"] !== seen["generated-1"] && seen["two-1"] !== seen["one-1"], seen),
        same("the same secret gives the same id again", seen["one-2"], seen["one-1"]),
      ]);
    },
  },
  {
    id: "dashboard-tracking-is-off-until-enabled-and-provisions-one-website",
    title: "with the option off the route answers 404; on, the first call creates one website named websiteName on the calling host, a second call (or host) creates nothing, a new host joins up to 20, and the site cannot be deleted",
    entryPoint: "POST /api/marketing/dashboard-tracking",
    async run(/** @type {Ctx} */ ctx) {
      const off = await provision(ctx);
      await ctx.verify("off by default", [same("status", off.status, 404)]);
      await withConfig(ctx, { dashboardTracking: { enabled: true, websiteName: "Back office" } }, async () => {
        const noOrigin = await raw(ctx, "provision with no Origin or Referer", { path: "/api/marketing/dashboard-tracking", method: "POST", as: "admin" });
        const first = await provision(ctx);
        const again = await provision(ctx);
        const staging = await provision(ctx, "https://staging.example.org");
        const sites = await mkt(ctx, "list the websites", "GET", "/websites");
        const site = list(sites.body)[0];
        await ctx.verify("one website per workspace, created on first use", [
          same("without a usable host", noOrigin.status, 400),
          same("the same id for every call", [first.status, text(first.json, "websiteId") !== "", text(again.json, "websiteId")], [200, true, text(first.json, "websiteId")]),
          same("one website, named websiteName, on the host the dashboard answered on", [list(sites.body).length, site?.name, site?.domain], [1, "Back office", DASHBOARD]),
          same("a new host joins the site's extra hosts", [staging.status, list((await mkt(ctx, "list the websites again", "GET", "/websites")).body)[0]?.extraDomains], [200, ["staging.example.org"]]),
          same("snapshots are off by default", site?.snapshotsEnabled, false),
        ]);
        const removed = await mkt(ctx, "delete the dashboard's website", "DELETE", `/websites/${text(first.json, "websiteId")}`);
        const renamed = await mkt(ctx, "rename it", "PUT", `/websites/${text(first.json, "websiteId")}`, { body: { name: "Renamed" } });
        const purged = await mkt(ctx, "purge it", "POST", `/websites/${text(first.json, "websiteId")}/purge`, { body: { scope: "all" } });
        await ctx.verify("it is an ordinary website, except that it cannot be deleted", [same("delete", removed.status, 409), same("rename", renamed.status, 200), same("purge", purged.status, 200)]);
      });
    },
  },
  {
    id: "the-collector-refuses-the-module-area-of-the-dashboards-website",
    title: "the collector refuses the module area (/modules, /modules/store, /modules/<module>/...) for the dashboard's website whatever the kind of event, and counts the other paths; another site's /modules page is counted",
    entryPoint: "POST /api/marketing/collect on the dashboard's website",
    async run(/** @type {Ctx} */ ctx) {
      await withConfig(ctx, { dashboardTracking: { enabled: true, excludePaths: ["/hidden"] } }, async () => {
        const provisioned = await provision(ctx);
        const site = { id: text(provisioned.json, "websiteId"), domain: DASHBOARD };
        const kept = ["/", "/profile", "/modulesx", "/module", "/hidden", "/auth/login"];
        const dropped = ["/modules", "/modules/store", "/modules/marketing/overview", "/modules/other/page"];
        const answer = await collect(ctx, "kept paths", site, kept.map((path) => pageview(site, path)));
        const countedAmongExcluded = [];
        for (const path of dropped) if ((await collect(ctx, `excluded path ${path}`, site, [pageview(site, path)], { ua: `Mozilla/5.0 Chrome/130 path-${path}` })).accepted === 1) countedAmongExcluded.push(path);
        const refused = { accepted: countedAmongExcluded.length, dropped: dropped.length - countedAmongExcluded.length, counted: countedAmongExcluded };
        const custom = await collect(ctx, "a custom event on the module area", site, [{ kind: "custom", url: `https://${DASHBOARD}/modules/marketing/overview`, name: "x" }]);
        await ctx.verify("which paths are counted", [
          same("the other paths are counted by the collector (the sign-in pages and excludePaths are left out by the dashboard's own tag)", [answer.accepted, answer.dropped], [kept.length, 0]),
          same("excluded paths that were counted anyway", refused.counted, []),
          same("any kind of event of the module area", custom.accepted, 0),
        ]);
        const other = await createSite(ctx, { domain: "other-site.example.org" });
        await collected(ctx, "another site's own /modules page", other, [pageview(other, "/modules"), pageview(other, "/modules/store")]);
      });
    },
  },
  {
    id: "malformed-dashboard-tracking-values-fall-back-to-their-defaults",
    title: "only enabled true turns it on and only snapshots true enables captures; a name past 100 characters or blank falls back to Dashboard; the snapshot option stops applying once an owner changes the switch",
    entryPoint: "antelope.config.ts dashboardTracking",
    async run(/** @type {Ctx} */ ctx) {
      await withConfig(ctx, { dashboardTracking: { enabled: "true" } }, async () => {
        const answer = await provision(ctx);
        await ctx.verify("a string is not true", [same("status", answer.status, 404)]);
      });
      await withConfig(ctx, { dashboardTracking: { enabled: true, websiteName: "n".repeat(101), snapshots: "yes" } }, async () => {
        const answer = await provision(ctx);
        const site = list((await mkt(ctx, "list the websites", "GET", "/websites")).body)[0];
        await ctx.verify("name and snapshots fall back", [same("status", answer.status, 200), same("name and snapshots", [site?.name, site?.snapshotsEnabled], ["Dashboard", false])]);
      });
      await withConfig(ctx, { dashboardTracking: { enabled: true, snapshots: true } }, async () => {
        const first = await provision(ctx);
        const created = list((await mkt(ctx, "list the websites", "GET", "/websites")).body)[0];
        await mkt(ctx, "an owner turns the snapshots off", "PUT", `/websites/${text(first.json, "websiteId")}`, { body: { snapshotsEnabled: false } });
        await provision(ctx);
        const after = list((await mkt(ctx, "list the websites again", "GET", "/websites")).body)[0];
        await ctx.verify("snapshots true enables the captures when the module creates the site; an owner's choice stands afterwards", [same("created with snapshots", created?.snapshotsEnabled, true), same("after the owner's change", after?.snapshotsEnabled, false)]);
      });
    },
  },
]);
