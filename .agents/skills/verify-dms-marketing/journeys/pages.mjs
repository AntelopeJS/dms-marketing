import { guarded } from "../guard.mjs";
import { check, list, mkt, num, pick, same } from "../marketing.mjs";
import { collect, collected, createSite, eventually, pageview } from "../site.mjs";
import { rows } from "../store.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */
/** @typedef {import("../site.mjs").Site} Site */

/**
 * @param {Ctx} ctx The journey
 * @param {Parameters<typeof createSite>[1]} [spec] The website
 * @returns {Promise<Site>} The website
 */
async function site(ctx, spec) {
  const created = await createSite(ctx, spec);
  await ctx.verify("the website exists", [check("POST /websites answers its id", created.id !== "", created.answer.body)], { critical: true });
  return created;
}

/**
 * @param {Site} target The website
 * @param {string} path The page
 * @param {Record<string, unknown>} data The click's data
 * @returns {Record<string, unknown>} The event
 */
const click = (target, path, data) => ({ kind: "click", url: `https://${target.domain}${path}`, data });

const BUY = { x: 0.2, y: 0.3, dx: 0.2, dy: 0.1, selector: "#buy", ox: 0.5, oy: 0.5, nth: 0 };

/** Pages and heatmaps: the inventory, the click and scroll reads and the reset (4.usage/3.pages-and-heatmaps.md, 7.architecture/3.http-api.md). */
export const journeys = guarded([
  {
    id: "the-pages-list-gives-views-clicks-and-sorts",
    title: "each observed path gives its views and clicks, sort=clicks orders by clicks and anything else by views, search narrows the paths, the default page holds 100 paths and says it is truncated",
    entryPoint: "GET /api/marketing/stats/pages",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx, { snapshotsEnabled: true });
      const agent = (/** @type {string} */ name) => ({ ua: `Mozilla/5.0 Chrome/130 ${name}` });
      await collected(ctx, "visitor one", shop, [pageview(shop, "/pricing", { data: { sample: 1 } }), click(shop, "/pricing", BUY), click(shop, "/pricing", BUY), pageview(shop, "/blog/a", { data: { sample: 1 } })], agent("one"));
      await collected(ctx, "visitor two", shop, [pageview(shop, "/blog/a", { data: { sample: 1 } }), click(shop, "/blog/a", BUY), click(shop, "/blog/a", BUY), click(shop, "/blog/a", BUY)], agent("two"));
      await collected(ctx, "visitor three", shop, [pageview(shop, "/blog/a"), pageview(shop, "/about")], agent("three"));
      const read = (/** @type {string} */ query) => eventually(() => mkt(ctx, `pages ${query}`, "GET", `/stats/pages?website=${shop.id}${query}`), (answer) => num(answer.body, "total") >= 1);
      const byViews = await read("");
      const byClicks = await read("&sort=clicks");
      const searched = await read("&search=BLOG");
      const shape = (/** @type {Awaited<ReturnType<typeof read>>} */ answer) => list(answer.body, "pages").map((page) => [page.path, page.pageviews, page.clicks]);
      await ctx.verify("the inventory", [
        same("by views (the busiest first)", shape(byViews).slice(0, 1), [["/blog/a", 3, 3]]),
        same("every path with its views and clicks", shape(byViews).sort(), [["/about", 1, 0], ["/blog/a", 3, 3], ["/pricing", 1, 2]]),
        same("by clicks", shape(byClicks).map((page) => page[0]), ["/blog/a", "/pricing", "/about"]),
        same("search is a case-insensitive filter on the path", shape(searched).map((page) => page[0]), ["/blog/a"]),
        same("flags the caller reads to explain an empty heatmap", [pick(byViews.body, "trackerEnabled"), pick(byViews.body, "snapshotsEnabled"), pick(byViews.body, "truncated"), pick(byViews.body, "total")], [true, true, false, 3]),
      ]);
    },
  },
  {
    id: "the-page-list-keeps-50-paths-a-day-and-the-heatmap-read-is-not-lossy",
    title: "a day keeps at most 50 paths in the list, limit narrows it and says it is truncated, and a path the list lost still has its heatmap",
    entryPoint: "GET /api/marketing/stats/pages, GET /api/marketing/stats/heatmap",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      for (let batch = 0; batch < 5; batch += 1) {
        await collected(ctx, `paths ${batch * 25}-${batch * 25 + 24}`, shop, Array.from({ length: 25 }, (_, index) => pageview(shop, `/p${String(batch * 25 + index).padStart(3, "0")}`)), { ua: `Mozilla/5.0 Chrome/130 batch-${batch}` });
      }
      await collected(ctx, "a click on the last path", shop, [click(shop, "/p124", BUY)], { ua: "Mozilla/5.0 Chrome/130 batch-4" });
      const full = await eventually(() => mkt(ctx, "pages with the default limit", "GET", `/stats/pages?website=${shop.id}`), (answer) => list(answer.body, "pages").length >= 50);
      const few = await mkt(ctx, "pages with limit=10", "GET", `/stats/pages?website=${shop.id}&limit=10`);
      const lost = await mkt(ctx, "the heatmap of a path the list lost", "GET", `/stats/heatmap?website=${shop.id}&path=/p124`);
      await ctx.verify("the list is lossy, the heatmap is not", [
        same("the rollup keeps 50 paths a day", list(full.body, "pages").length, 50),
        same("limit=10", [list(few.body, "pages").length, pick(few.body, "truncated")], [10, true]),
        same("the lost path still has its click", pick(lost.body, "totalClicks"), 1),
      ]);
    },
  },
  {
    id: "clicks-stick-to-elements-and-fall-back-to-document-cells",
    title: "clicks on one element add up in one anchored point whatever the window size, clicks without an anchor are counted by document cell, the total and the maximum weight are exact, other paths and other websites are not mixed in",
    entryPoint: "GET /api/marketing/stats/heatmap",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const other = await site(ctx);
      await collected(ctx, "clicks on the pricing page", shop, [
        pageview(shop, "/pricing"),
        click(shop, "/pricing", BUY),
        click(shop, "/pricing", { ...BUY, x: 0.25, y: 0.9, dx: 0.25, dy: 0.45 }),
        click(shop, "/pricing", { ...BUY, selector: "#nav a", nth: 1, ox: 0.1, oy: 0.2, dx: 0.9, dy: 0.01 }),
        click(shop, "/pricing", { x: 0.7, y: 0.3, dx: 0.7, dy: 0.1 }),
        click(shop, "/pricing", { x: 0.7, y: 0.3, dx: 0.7, dy: 0.1 }),
        click(shop, "/other", BUY),
      ]);
      await collected(ctx, "a click on the other website", other, [pageview(other, "/pricing"), click(other, "/pricing", BUY)]);
      const read = await eventually(() => mkt(ctx, "read the heatmap", "GET", `/stats/heatmap?website=${shop.id}&path=/pricing`), (answer) => num(answer.body, "totalClicks") === 5);
      const points = list(read.body, "points");
      const anchored = points.filter((point) => point.anchor);
      const plain = points.filter((point) => !point.anchor);
      await ctx.verify("the heatmap", [
        same("total clicks and the busiest point", [pick(read.body, "totalClicks"), pick(read.body, "maxWeight"), pick(read.body, "truncated")], [5, 2, false]),
        same("two clicks on #buy with different window positions are one anchored point", anchored.map((point) => [pick(point, "anchor", "selector"), pick(point, "anchor", "nth"), point.weight]).sort(), [["#buy", 0, 2], ["#nav a", 1, 1]].sort()),
        same("clicks with no anchor fall back to one cell", plain.map((point) => point.weight), [2]),
      ]);
      const without = await mkt(ctx, "read the heatmap without a path", "GET", `/stats/heatmap?website=${shop.id}`);
      const ghost = await mkt(ctx, "read a path nobody visited", "GET", `/stats/heatmap?website=${shop.id}&path=/ghost`);
      await ctx.verify("a missing path is not a path without clicks", [check("a path is required", without.status === 400, without.status), same("an unknown path has no clicks", [pick(ghost.body, "totalClicks"), list(ghost.body, "points").length], [0, 0])]);
      const out = await mkt(ctx, "read a window that ended before the clicks", "GET", `/stats/heatmap?website=${shop.id}&path=/pricing&from=2020-01-01T00:00:00.000Z&to=2020-01-31T23:59:59.000Z`);
      await ctx.verify("the window", [same("no clicks in 2020", pick(out.body, "totalClicks"), 0)]);
    },
  },
  {
    id: "scroll-depth-counts-the-views-that-reached-each-depth",
    title: "the scroll read gives the sampled views and, per percent, how many reached it",
    entryPoint: "GET /api/marketing/stats/scroll",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const depth = (/** @type {number} */ value) => ({ kind: "scroll", url: `https://${shop.domain}/long`, data: { depth: value } });
      for (const [index, value] of [0, 40, 40, 90, 100].entries()) await collected(ctx, `a view that reached ${value} %`, shop, [pageview(shop, "/long"), depth(value)], { ua: `Mozilla/5.0 Chrome/130 reader-${index}` });
      const read = await eventually(() => mkt(ctx, "read the scroll depth", "GET", `/stats/scroll?website=${shop.id}&path=/long`), (answer) => num(answer.body, "views") === 5);
      const reached = /** @type {number[]} */ (pick(read.body, "reached"));
      await ctx.verify("who reached what", [
        same("views", pick(read.body, "views"), 5),
        same("101 steps, 0 to 100", reached.length, 101),
        same("everyone reached 0", reached[0], 5),
        same("40 % was reached by four views", [reached[40], reached[41]], [4, 2]),
        same("90 % by two, 91 % by one", [reached[90], reached[91], reached[100]], [2, 1, 1]),
      ]);
    },
  },
  {
    id: "a-heatmap-reset-deletes-one-path-and-counts-what-it-deletes",
    title: "the reset count and the reset delete the clicks, scroll depths and snapshots of one path (or of the whole site), whatever the period, keep the pageviews, need a website, and leave other paths alone",
    entryPoint: "GET /api/marketing/stats/heatmap/count, DELETE /api/marketing/stats/heatmap",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      await collected(ctx, "clicks and scrolls on two pages", shop, [pageview(shop, "/a"), click(shop, "/a", BUY), click(shop, "/a", BUY), { kind: "scroll", url: `https://${shop.domain}/a`, data: { depth: 50 } }, pageview(shop, "/b"), click(shop, "/b", BUY)]);
      const count = await mkt(ctx, "count what a reset of /a deletes", "GET", `/stats/heatmap/count?website=${shop.id}&path=/a`);
      const noWebsite = await mkt(ctx, "reset without a website", "DELETE", "/stats/heatmap?path=/a");
      const reset = await mkt(ctx, "reset /a", "DELETE", `/stats/heatmap?website=${shop.id}&path=/a`);
      const a = await mkt(ctx, "read /a", "GET", `/stats/heatmap?website=${shop.id}&path=/a`);
      const b = await mkt(ctx, "read /b", "GET", `/stats/heatmap?website=${shop.id}&path=/b`);
      const events = await rows(ctx, "marketing_events", { websiteId: shop.id });
      await ctx.verify("a reset of one path", [
        same("the count: events (clicks and scroll depths) and snapshots", [pick(count.body, "events"), pick(count.body, "snapshots")], [3, 0]),
        check("a website is required: the request is refused and deletes nothing", noWebsite.status >= 400, noWebsite.status),
        same("the reset answers what it deleted", [pick(reset.body, "events"), pick(reset.body, "snapshots")], [3, 0]),
        same("/a has no clicks, /b keeps its click", [pick(a.body, "totalClicks"), pick(b.body, "totalClicks")], [0, 1]),
        same("the pageviews stay", events.filter((event) => event.kind === "pageview").length, 2),
      ]);
      const whole = await mkt(ctx, "reset the whole site", "DELETE", `/stats/heatmap?website=${shop.id}`);
      const left = await rows(ctx, "marketing_events", { websiteId: shop.id });
      await ctx.verify("a reset of the whole site", [same("deleted", pick(whole.body, "events"), 1), same("only the pageviews remain", left.map((event) => event.kind), ["pageview", "pageview"])]);
    },
  },
  {
    id: "the-sample-rate-is-the-average-of-the-declared-rates-over-enough-views",
    title: "the pages list reports the sampling the tracker really applied: the average of the rates the pageviews declared, once at least 20 pageviews declared one",
    entryPoint: "GET /api/marketing/stats/pages",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const batch = (/** @type {number} */ rate, /** @type {number} */ count) => Array.from({ length: count }, () => pageview(shop, "/rated", { data: { sample: rate } }));
      await collect(ctx, "10 views declared at 50 %", shop, batch(0.5, 10), { ua: "Mozilla/5.0 Chrome/130 rate-a" });
      const few = await eventually(() => mkt(ctx, "read the pages", "GET", `/stats/pages?website=${shop.id}`), (answer) => num(answer.body, "total") === 1);
      await collect(ctx, "10 views declared at 10 %", shop, batch(0.1, 10), { ua: "Mozilla/5.0 Chrome/130 rate-b" });
      const enough = await eventually(() => mkt(ctx, "read the pages again", "GET", `/stats/pages?website=${shop.id}`), (answer) => list(answer.body, "pages")[0]?.pageviews === 20);
      const rate = num(enough.body, "sampleRate");
      await ctx.verify("the sampling note", [same("under 20 declared views there is no rate", pick(few.body, "sampleRate"), null), check("20 views, half at 50 % and half at 10 %: 30 %", Math.abs(rate - 0.3) < 0.001, rate)]);
    },
  },
]);
