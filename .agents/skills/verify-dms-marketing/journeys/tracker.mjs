import { guarded } from "../guard.mjs";
import { check, mkt, pick, raw, same } from "../marketing.mjs";
import { local, open, settled, stored, waitFor } from "./parts/tracker-helpers.mjs";
import { journeys as exclusion } from "./parts/tracker-exclude.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */

/** The tracker script and its page API (4.usage/9.tracking.md, 2.installation.md). */
export const journeys = guarded([
  {
    id: "the-tag-sets-the-heatmap-sampling-of-its-site",
    title: "data-heatmap-sample 0 records no click and declares 0, 1 records every click and declares 1, and a tag without it declares the module's rate",
    entryPoint: "data-heatmap-sample",
    async run(/** @type {Ctx} */ ctx) {
      const site = await local(ctx);
      const rates = [];
      for (const rate of ["0", "1"]) {
        const tab = await open(ctx, site, `rate-${rate}`, { attrs: { "data-heatmap-sample": rate } });
        const views = await waitFor(ctx, site, "pageview", (found) => found.filter((event) => event.url === `/verify-marketing/site/rate-${rate}`).length >= 1);
        await tab.page.click("#buy");
        const here = (/** @type {Record<string, unknown>[]} */ found) => found.filter((event) => event.url === `/verify-marketing/site/rate-${rate}`);
        if (rate === "1") await waitFor(ctx, site, "click", (found) => here(found).length >= 1, 20_000);
        else await new Promise((resolve) => setTimeout(resolve, 7000));
        const clicks = here(await stored(ctx, site, "click")).length;
        rates.push([rate, pick(views.find((event) => event.url === `/verify-marketing/site/rate-${rate}`), "data", "sample"), clicks]);
      }
      await ctx.verify("sampling by tag", [same("declared rate and recorded clicks per tag", rates, [["0", 0, 0], ["1", 1, 1]])]);
      await mkt(ctx, "set the module sampling to 100 %", "PUT", "/settings", { body: { heatmapSamplePercent: 100 } });
      await open(ctx, site, "module-rate", { account: "visitor-after-save" });
      const views = await waitFor(ctx, site, "pageview", (found) => found.some((event) => event.url === "/verify-marketing/site/module-rate"));
      await ctx.verify("a tag without the attribute follows the module setting", [same("declared rate", pick(views.find((event) => event.url === "/verify-marketing/site/module-rate"), "data", "sample"), 1)]);
    },
  },

  {
    id: "a-page-load-sends-a-pageview-with-its-context",
    title: "the tracker counts a page load and sends the path, the title, the screen, the language and the referrer; it sets no cookie and uses no storage",
    entryPoint: "GET /api/marketing/tracker.js, POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const site = await local(ctx);
      const tab = await open(ctx, site, "landing", { attrs: { "data-heatmap-sample": "0" } });
      const events = await waitFor(ctx, site, "pageview", (found) => found.length >= 1);
      const cookies = await tab.page.context().cookies();
      const keys = await tab.page.evaluate(() => [localStorage.length, sessionStorage.length]);
      await ctx.verify("one pageview of the landing page", [
        same("pageviews and their path", [events.length, events[0]?.url], [1, "/verify-marketing/site/landing"]),
        same("no cookie, nothing in the storages", [cookies.length, keys], [0, [0, 0]]),
        check("the API exposes the page API", await tab.page.evaluate(() => window.dmsMarketing?.track instanceof Function && window.dmsMarketing?.variation instanceof Function && window.dmsMarketing?.exposure instanceof Function), "dmsMarketing"),
      ]);
      const sessions = await (await import("../store.mjs")).rows(ctx, "marketing_sessions", { websiteId: site.id });
      await ctx.verify("the session context", [same("language", sessions[0]?.language, "en-US"), check("screen is width x height", /^\d+x\d+$/.test(String(sessions[0]?.screen)), sessions[0]?.screen)]);
      await settled(ctx, site, "pageview", 1);
    },
  },
  {
    id: "single-page-navigations-count-and-query-or-hash-updates-do-not",
    title: "pushState, replaceState and back each count a page; a call that leaves the path unchanged (query, hash) and a hash route do not",
    entryPoint: "history.pushState, history.replaceState, popstate",
    async run(/** @type {Ctx} */ ctx) {
      const site = await local(ctx);
      const tab = await open(ctx, site, "spa", { attrs: { "data-heatmap-sample": "0" } });
      await waitFor(ctx, site, "pageview", (found) => found.length >= 1);
      const step = async (/** @type {string} */ script, /** @type {number} */ expected) => {
        await tab.page.evaluate(script);
        return waitFor(ctx, site, "pageview", (found) => found.length >= expected, 6000);
      };
      const afterPush = await step("history.pushState({}, '', '/verify-marketing/site/pushed')", 2);
      const afterReplace = await step("history.replaceState({}, '', '/verify-marketing/site/replaced')", 3);
      await tab.page.evaluate("history.pushState({}, '', '/verify-marketing/site/replaced?tab=2')");
      await tab.page.evaluate("history.pushState({}, '', '/verify-marketing/site/replaced?tab=2#/pricing')");
      await tab.page.evaluate("location.hash = '#/other'");
      const afterNoop = await settled(ctx, site, "pageview", 3);
      const afterFourth = await step("history.pushState({}, '', '/verify-marketing/site/fourth')", 4);
      const afterBack = await step("history.back()", 5);
      await ctx.verify("which navigations count", [
        same("pushState", afterPush.map((event) => event.url), ["/verify-marketing/site/spa", "/verify-marketing/site/pushed"]),
        same("replaceState", afterReplace.length, 3),
        afterNoop,
        same("a push after the no-ops counts", afterFourth.length, 4),
        same("back (popstate) counts the page it lands on", afterBack.map((event) => event.url).slice(-2), ["/verify-marketing/site/fourth", "/verify-marketing/site/replaced"]),
      ]);
    },
  },
  {
    id: "do-not-track-and-global-privacy-control-are-honoured-unless-the-tag-opts-out",
    title: "a browser that sends DNT or GPC is not collected and gets a no-op API; data-do-not-track=false collects it anyway",
    entryPoint: "navigator.doNotTrack, navigator.globalPrivacyControl",
    async run(/** @type {Ctx} */ ctx) {
      const site = await local(ctx);
      const dnt = await open(ctx, site, "dnt", { init: "Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true })", js: "window.dmsMarketing?.track('while-dnt')" });
      await open(ctx, site, "gpc", { init: "Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true })", js: "window.dmsMarketing?.track('while-gpc')" });
      const still = await settled(ctx, site, undefined, 0);
      const noop = await dnt.page.evaluate(() => window.dmsMarketing?.track instanceof Function);
      const variation = await dnt.page.evaluate(() => window.dmsMarketing?.variation("hero"));
      await ctx.verify("DNT and GPC are respected", [still, same("the API stays callable", noop, true), same("variation() answers null", variation, null)]);
      await open(ctx, site, "dnt-optout", { init: "Object.defineProperty(navigator, 'doNotTrack', { value: '1', configurable: true })", attrs: { "data-do-not-track": "false", "data-heatmap-sample": "0" } });
      const events = await waitFor(ctx, site, "pageview", (found) => found.length >= 1);
      await ctx.verify("the tag can opt out of honouring it", [same("pageviews", events.map((event) => event.url), ["/verify-marketing/site/dnt-optout"])]);
    },
  },
  {
    id: "custom-events-come-from-the-page-api",
    title: "track(name, data) reports a custom event, a name past 50 characters is cut, data past 4,096 characters drops that event only, and the tag included twice counts once",
    entryPoint: "window.dmsMarketing.track",
    async run(/** @type {Ctx} */ ctx) {
      const site = await local(ctx);
      const tab = await open(ctx, site, "events", { twice: true, attrs: { "data-heatmap-sample": "0" } });
      const warnings = [];
      tab.page.on("console", (message) => warnings.push(message.text()));
      await waitFor(ctx, site, "pageview", (found) => found.length >= 1);
      await tab.page.evaluate(() => {
        window.dmsMarketing?.track("signup_submitted", { plan: "pro" });
        window.dmsMarketing?.track("n".repeat(60));
        window.dmsMarketing?.track("too_big", { text: "x".repeat(5000) });
        window.dmsMarketing?.track("after_big");
      });
      const events = await waitFor(ctx, site, "custom", (found) => found.length >= 3, 15_000);
      await ctx.verify("custom events", [
        same("names in order, the oversized one dropped", events.map((event) => event.name), ["signup_submitted", "n".repeat(50), "after_big"]),
        same("data travels with the event", events[0]?.data, { plan: "pro" }),
        same("the tag included twice counted one pageview", (await stored(ctx, site, "pageview")).length, 1),
      ]);
    },
  },
  {
    id: "an-excluded-page-sends-nothing",
    title: "a page matching data-exclude-paths sends no pageview and no custom event while it is on screen; the next page counts as usual",
    entryPoint: "data-exclude-paths",
    async run(/** @type {Ctx} */ ctx) {
      const site = await local(ctx);
      const tab = await open(ctx, site, "private/area", { attrs: { "data-exclude-paths": "/verify-marketing/site/private/*", "data-heatmap-sample": "0" }, js: "window.dmsMarketing?.track('hidden-event')" });
      const quiet = await settled(ctx, site, undefined, 0);
      await tab.page.evaluate("history.pushState({}, '', '/verify-marketing/site/public')");
      const events = await waitFor(ctx, site, "pageview", (found) => found.length >= 1);
      await ctx.verify("excluded paths", [quiet, same("the page navigated to counts", events.map((event) => event.url), ["/verify-marketing/site/public"])]);
    },
  },
  {
    id: "the-website-id-of-the-tag-can-change",
    title: "removing data-website-id pauses the tracker; setting it again sends for the new id",
    entryPoint: "data-website-id",
    async run(/** @type {Ctx} */ ctx) {
      const site = await local(ctx);
      const tab = await open(ctx, site, "ids", { attrs: { "data-heatmap-sample": "0" } });
      await waitFor(ctx, site, "pageview", (found) => found.length >= 1);
      await tab.page.evaluate(() => document.querySelector("script[data-website-id]")?.removeAttribute("data-website-id"));
      await tab.page.evaluate(() => window.dmsMarketing?.track("without-id"));
      const none = await settled(ctx, site, "custom", 0);
      await tab.page.evaluate(`document.querySelector("script[src*='tracker.js']")?.setAttribute("data-website-id", ${JSON.stringify(site.id)})`);
      await tab.page.evaluate(() => window.dmsMarketing?.track("with-id"));
      const events = await waitFor(ctx, site, "custom", (found) => found.length >= 1);
      await ctx.verify("the id can disappear and come back", [none, same("events once it is set again", events.map((event) => event.name), ["with-id"])]);
    },
  },
  {
    id: "the-served-script-carries-the-settings-and-a-stub-when-paused",
    title: "tracker.js is public, cached for an hour, carries the sampling rate; paused it is a no-op cached for a minute; a module script has no API",
    entryPoint: "GET /api/marketing/tracker.js",
    async run(/** @type {Ctx} */ ctx) {
      const site = await local(ctx);
      const script = await raw(ctx, "the tracker", { path: "/api/marketing/tracker.js" });
      const viaDashboard = await raw(ctx, "the tracker through the dashboard's origin, no session", { path: "/api/marketing/tracker.js", origin: "web" });
      const guarded = await raw(ctx, "a route the dashboard does not declare public", { path: "/api/marketing/websites", origin: "web" });
      await ctx.verify("the live script", [
        same("status, type and cache", [script.status, script.headers["content-type"]?.split(";")[0], script.headers["cache-control"]], [200, "application/javascript", "public, max-age=3600"]),
        check("the settings come first", script.text.startsWith("window.") && script.text.includes('"heatmapSampleRate":0.1') && script.text.includes('"paused":false'), script.text.slice(0, 120)),
        same("the dashboard's origin serves it without a session", viaDashboard.status, 200),
        check("and refuses an undeclared route without one", guarded.status === 401 || guarded.status === 403, guarded.status),
      ]);
      await mkt(ctx, "set the sampling to 25 %", "PUT", "/settings", { body: { heatmapSamplePercent: 25 } });
      await mkt(ctx, "pause the collection", "POST", "/settings/collection", { body: { enabled: false } });
      const paused = await raw(ctx, "the tracker while paused", { path: "/api/marketing/tracker.js" });
      await ctx.verify("the paused stub", [
        same("cache lifetime", paused.headers["cache-control"], "public, max-age=60"),
        check("paused and with the new rate", paused.text.includes('"paused":true') && paused.text.includes('"heatmapSampleRate":0.25'), paused.text.slice(0, 120)),
      ]);
      await open(ctx, site, "paused", { js: "window.dmsMarketing?.track('while-paused')" });
      const nothing = await settled(ctx, site, undefined, 0);
      await mkt(ctx, "resume the collection", "POST", "/settings/collection", { body: { enabled: true } });
      const moduleTab = await open(ctx, site, "module", { module: true });
      const absent = await moduleTab.page.evaluate(() => (window.dmsMarketing === undefined ? "undefined" : "defined"));
      await ctx.verify("paused sites send nothing, a module script has no API", [nothing, same("window.dmsMarketing", absent, "undefined")]);
    },
  },
  ...exclusion,
]);
