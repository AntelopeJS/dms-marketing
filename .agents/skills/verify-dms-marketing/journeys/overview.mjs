import { guarded } from "../guard.mjs";
import { check, list, mkt, num, pick, same } from "../marketing.mjs";
import { collected, pageview } from "../site.mjs";
import { block, history, period, shop, utcDay } from "./parts/overview-helpers.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */

const WEEK = period(6, 0);

/** The Overview: context, period, comparison and the blocks (4.usage/1.overview.md, 7.architecture/4.context-and-period.md). */
export const journeys = guarded([
  {
    id: "the-kpi-cards-change-against-the-comparison-window",
    title: "each KPI card gives its value, the previous value, the change in percent and a daily sparkline; with no comparison the change is left out, not 0",
    entryPoint: "GET /api/marketing/blocks/kpi",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await history(ctx, site, [
        { visitor: "a", daysAgo: 3, minutes: [0, 1], paths: ["/a", "/b"], custom: ["signup"] },
        { visitor: "b", daysAgo: 3, minutes: [1, 2], paths: ["/a", "/b"] },
        { visitor: "c", daysAgo: 3, minutes: [2, 3], paths: ["/a", "/b"] },
        { visitor: "old", daysAgo: 10, minutes: [0], paths: ["/a"] },
        { visitor: "old2", daysAgo: 11, minutes: [0], paths: ["/a"] },
        { visitor: "ancient", daysAgo: 100, minutes: [0], paths: ["/a"] },
      ]);
      const metrics = ["pageviews", "sessions", "new-visitors", "custom-events"];
      const reads = [];
      for (const metric of metrics) reads.push(await block(ctx, site, `/blocks/kpi?metric=${metric}`, WEEK));
      await ctx.verify("values, previous values and changes", [
        same("values", reads.map((read) => num(read.body, "value")), [6, 3, 3, 1]),
        same("previous values", reads.map((read) => num(read.body, "previousValue")), [2, 2, 2, 0]),
        same("changes in percent (a zero baseline has none)", reads.map((read) => pick(read.body, "delta") ?? null), [200, 50, 50, null]),
      ]);
      await ctx.verify("the sparkline holds one point per day before today, the busy day in its place", [
        same("pageviews", pick(reads[0]?.body, "sparkline"), [0, 0, 0, 6, 0, 0]),
        same("custom events", pick(reads[3]?.body, "sparkline"), [0, 0, 0, 1, 0, 0]),
      ]);
      const none = await block(ctx, site, "/blocks/kpi?metric=pageviews", period(6, 0, "none"));
      await ctx.verify("with no comparison the change is left out", [same("value", num(none.body, "value"), 6), check("no previous value and no change", pick(none.body, "previousValue") === undefined && pick(none.body, "delta") === undefined, none.body)]);
      const unknown = await block(ctx, site, "/blocks/kpi?metric=nonsense", WEEK);
      await ctx.verify("an unknown metric is refused", [same("status", unknown.status, 400)]);
      const default7 = await mkt(ctx, "the overview with no period", "GET", `/stats/overview?website=${site.id}`);
      const cut = await mkt(ctx, "a window of 120 days", "GET", `/stats/overview?website=${site.id}&from=${new Date(utcDay(119)).toISOString()}&to=${new Date(utcDay(0) + 86_399_999).toISOString()}`);
      await ctx.verify("no period reads 7 days; a window past 90 days is cut at its start", [
        same("last 7 days", num(default7.body, "totals", "pageviews"), 6),
        same("120 days: the sessions of 10 and 11 days ago count, the one of 100 days ago is cut off", [num(cut.body, "totals", "pageviews"), list(cut.body, "days").length], [8, 3]),
      ]);
    },
  },
  {
    id: "the-traffic-chart-and-the-quality-strip",
    title: "the chart draws sessions or pageviews by day against the comparison window; bounce rate, average duration and pages per session derive from the sessions",
    entryPoint: "GET /api/marketing/blocks/traffic, GET /api/marketing/blocks/quality",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await history(ctx, site, [
        { visitor: "a", daysAgo: 2, minutes: [0, 2], paths: ["/a", "/b"] },
        { visitor: "b", daysAgo: 2, minutes: [10, 14], paths: ["/a", "/b"] },
        { visitor: "c", daysAgo: 2, minutes: [30], paths: ["/a"] },
        { visitor: "d", daysAgo: 2, minutes: [40], paths: ["/a"] },
        { visitor: "p", daysAgo: 9, minutes: [0, 1, 2], paths: ["/a", "/b", "/c"] },
      ]);
      const traffic = await block(ctx, site, "/blocks/traffic?metric=sessions", WEEK);
      const pageviews = await block(ctx, site, "/blocks/traffic?metric=pageviews", WEEK);
      const series = list(traffic.body, "series")[0];
      await ctx.verify("the chart", [
        same("sessions of the window and before it", [num(traffic.body, "value"), num(traffic.body, "previousValue")], [4, 1]),
        same("sessions by day", list(series, "data").slice(0, 6).map((point) => point.y), [0, 0, 0, 0, 4, 0]),
        same("the comparison series has one point per day", list(traffic.body, "comparisonSeries")[0] && list(list(traffic.body, "comparisonSeries")[0], "data").length, 7),
        same("pageviews of the window and before it", [num(pageviews.body, "value"), num(pageviews.body, "previousValue")], [6, 3]),
      ]);
      const quality = await block(ctx, site, "/blocks/quality", WEEK);
      const items = Object.fromEntries(list(quality.body, "items").map((item) => [String(item.id), item]));
      await ctx.verify("session quality", [
        same("bounce rate: 2 of 4 sessions saw one page", pick(items["bounce-rate"], "value", "params", "value", "value"), 50),
        same("pages per session: 6 pageviews over 4 sessions", pick(items["pages-per-session"], "value"), 1.5),
        same("average duration: gaps of 2, 4, 0 and 0 minutes over 4 sessions", [pick(items.duration, "value", "params", "minutes"), pick(items.duration, "value", "params", "seconds")], [1, 30]),
        same("the bounce change reads in points (50 % against 0 % before): an increase is the bad direction", [pick(items["bounce-rate"], "detail", "params", "sign"), pick(items["bounce-rate"], "detail", "params", "value", "params", "value", "value"), pick(items["bounce-rate"], "detailTone")], ["+", 50, "error"]),
      ]);
    },
  },
  {
    id: "devices-and-the-tabbed-top-lists",
    title: "devices, pages, entry and exit pages, browsers, languages, custom events with their goal tag are ranked exactly over the period",
    entryPoint: "GET /api/marketing/blocks/devices, GET /api/marketing/blocks/tops, GET /api/marketing/blocks/top",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      const phone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
      await collected(ctx, "a desktop visitor: /a then /b, a signup", site, [pageview(site, "/a", { language: "fr-FR" }), pageview(site, "/b"), { kind: "custom", url: `https://${site.domain}/b`, name: "signup" }]);
      await collected(ctx, "a phone visitor: /a", site, [pageview(site, "/a", { language: "en-US" })], { ua: phone });
      await ctx.verify("goal events need a funnel", [check("the fixture declares a funnel ending with signup", (await import("../marketing.mjs")).pick(await ctxFunnel(ctx, site), "ok") === true, "funnel")]);
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const devices = await block(ctx, site, "/blocks/devices", WEEK);
      await ctx.verify("devices", [same("sessions by type", list(devices.body, "items").map((item) => [item.id, item.value, item.share]).sort(), [["desktop", 1, 50], ["mobile", 1, 50]])]);
      const content = await block(ctx, site, "/blocks/tops?group=content", WEEK);
      const tabs = Object.fromEntries(list(content.body, "tabs").map((tab) => [String(tab.id), list(tab, "items").map((item) => [item.id, item.value])]));
      await ctx.verify("content", [
        same("top pages", tabs.pages, [["/a", 2], ["/b", 1]]),
        same("entry pages", tabs.entry, [["/a", 2]]),
        same("exit pages: the last page seen of each session", [...(tabs.exit ?? [])].sort(), [["/a", 1], ["/b", 1]]),
      ]);
      const audience = await block(ctx, site, "/blocks/tops?group=audience", WEEK);
      const audienceTabs = Object.fromEntries(list(audience.body, "tabs").map((tab) => [String(tab.id), list(tab, "items").map((item) => [item.id, item.value])]));
      await ctx.verify("audience", [same("languages", [...(audienceTabs.languages ?? [])].sort(), [["en-US", 1], ["fr-FR", 1]]), check("browsers include Chrome and Mobile Safari once each", JSON.stringify(audienceTabs.browsers).includes("Chrome") && JSON.stringify(audienceTabs.browsers).includes("Safari"), audienceTabs.browsers)]);
      const events = await block(ctx, site, "/blocks/tops?group=events", WEEK);
      const signup = list(list(events.body, "tabs")[0], "items")[0];
      await ctx.verify("custom events", [same("ranked by count", [signup?.id, signup?.value], ["signup", 1]), check("the event that ends a funnel carries a goal tag", JSON.stringify(signup).toLowerCase().includes("goal"), signup)]);
      const five = await block(ctx, site, "/blocks/top?dimension=topPages", WEEK);
      const over = await block(ctx, site, "/blocks/top?dimension=topPages&limit=51", WEEK);
      const nonsense = await block(ctx, site, "/blocks/top?dimension=nonsense", WEEK);
      await ctx.verify("the generic top list", [same("rows", list(five.body, "items").length, 2), same("a limit past 50 is refused or capped", over.status === 400 || list(over.body, "items").length <= 50, true), same("an unknown dimension is refused", nonsense.status, 400)]);
    },
  },
  {
    id: "the-context-bar-picks-a-website-and-remembers-it",
    title: "the websites are listed most recently active first with their state, the pick is saved per member and a first-run notice shows until the first event",
    entryPoint: "GET /api/marketing/context, PUT /api/marketing/context, GET /api/marketing/blocks/website-notice",
    async run(/** @type {Ctx} */ ctx) {
      const quiet = await shop(ctx);
      const busy = await shop(ctx);
      const notice = await block(ctx, busy, "/blocks/website-notice", WEEK);
      await ctx.verify("while a website has sent nothing, the notice leads to the install guide", [check("a banner", notice.body !== null && notice.body !== "" && JSON.stringify(notice.body).includes("install"), notice.body)]);
      await collected(ctx, "the busy website's first pageview", busy, [pageview(busy, "/x")]);
      const noticeAfter = await block(ctx, busy, "/blocks/website-notice", WEEK);
      const read = await mkt(ctx, "read the context", "GET", "/context");
      await ctx.verify("the order and the states", [
        same("the notice is gone", noticeAfter.body === "" || noticeAfter.body === null, true),
        same("most recently active first", list(read.body, "websites").map((site) => site.id), [busy.id, quiet.id]),
        same("states", list(read.body, "websites").map((site) => site.state), ["live", "waiting"]),
        same("the pick defaults to the most recently active website", pick(read.body, "selectedId"), busy.id),
      ]);
      const put = await mkt(ctx, "pick the quiet website", "PUT", "/context", { body: { website: quiet.id } });
      const after = await mkt(ctx, "read the context again", "GET", "/context");
      const unknown = await mkt(ctx, "pick a website that does not exist", "PUT", "/context", { body: { website: "does-not-exist" } });
      await ctx.verify("the pick is saved", [same("saved", put.status, 200), same("remembered", pick(after.body, "selectedId"), quiet.id), check("an unknown website is not stored", unknown.status >= 400 || pick((await mkt(ctx, "read the context", "GET", "/context")).body, "selectedId") === quiet.id, unknown.status)]);
    },
  },
]);

/**
 * Declares a funnel whose last step is the `signup` custom event.
 *
 * @param {Ctx} ctx The journey
 * @param {import("../site.mjs").Site} site The website
 * @returns {Promise<unknown>} The fixture's answer
 */
async function ctxFunnel(ctx, site) {
  const { fixture } = await import("../marketing.mjs");
  const answer = await fixture(ctx, "declare a funnel that ends with signup", "POST", "/funnel", { tenantId: "default", id: "goal-funnel", websiteId: site.id, name: "Signup", steps: [{ kind: "url", value: "/a" }, { kind: "custom", value: "signup" }] });
  return answer.body;
}
