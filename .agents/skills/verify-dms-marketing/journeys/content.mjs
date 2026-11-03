import { guarded } from "../guard.mjs";
import { check, fixture, list, mkt, num, pick, same, text } from "../marketing.mjs";
import { collect, createSite, eventually, overview, pageview } from "../site.mjs";
import { rows } from "../store.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */

/**
 * @param {Ctx} ctx The journey
 * @param {string} call The fixture route
 * @param {Record<string, unknown>} body The declaration as the interface takes it
 * @returns {Promise<{ ok: unknown, status: unknown, error: string }>} What the interface call answered
 */
async function ship(ctx, call, body) {
  const answer = await fixture(ctx, `${call} ${text(body, "id") || text(body, "importId") || ""}`, "POST", `/${call}`, body);
  return { ok: pick(answer.body, "ok"), status: pick(answer.body, "result", "status"), error: text(answer.body, "error") };
}

const WEBSITE = { tenantId: "default", id: "shop-site", name: "Shop", domain: "shop.example.com" };

/** Content from code through the interface (5.extending.md, 7.architecture/7.interface.md). */
export const journeys = guarded([
  {
    id: "a-declared-website-is-written-once-by-its-id",
    title: "EnsureWebsite answers created, then kept for the same id whatever else the call says, and keeps what the first call wrote; the dashboard's rules apply",
    entryPoint: "EnsureWebsite",
    async run(/** @type {Ctx} */ ctx) {
      const first = await ship(ctx, "website", { ...WEBSITE, extraDomains: ["staging.shop.example.com"], snapshotsEnabled: true });
      const again = await ship(ctx, "website", { ...WEBSITE, name: "Renamed", domain: "other.example.com" });
      const read = list((await mkt(ctx, "list the websites", "GET", "/websites")).body);
      await ctx.verify("created once", [
        same("first, then kept", [first.status, again.status], ["created", "kept"]),
        same("one site holding the first call's values", [read.length, read[0]?._id, read[0]?.name, read[0]?.domain, read[0]?.extraDomains, read[0]?.snapshotsEnabled, read[0]?.trackingEnabled], [1, "shop-site", "Shop", "shop.example.com", ["staging.shop.example.com"], true, true]),
      ]);
      const viaDashboard = await createSite(ctx, { name: "Made in the dashboard", domain: "dash.example.com" });
      const kept = await ship(ctx, "website", { tenantId: "default", id: viaDashboard.id, name: "Declared", domain: "declared.example.com" });
      const duplicateHost = await ship(ctx, "website", { ...WEBSITE, id: "second-site", name: "Second", domain: "shop.example.com" });
      const badDomain = await ship(ctx, "website", { ...WEBSITE, id: "bad-site", domain: "not a host!" });
      await ctx.verify("an id made in the dashboard is kept, and the dashboard's rules refuse the rest", [
        same("kept", kept.status, "kept"),
        same("a host another site declares", duplicateHost.ok, false),
        same("a value that is not a host", badDomain.ok, false),
      ]);
    },
  },
  {
    id: "every-content-call-needs-an-explicit-tenant",
    title: "a missing, blank or padded tenant id rejects before anything is written, for the four content calls",
    entryPoint: "EnsureWebsite, EnsureFunnel, EnsurePageSnapshot, ImportAnalytics",
    async run(/** @type {Ctx} */ ctx) {
      const calls = [
        ["website", WEBSITE],
        ["funnel", { id: "f", websiteId: "w", name: "F", steps: [{ kind: "url", value: "/" }] }],
        ["snapshot", { websiteId: "w", url: "https://shop.example.com/", html: "<p>x</p>", viewport: { width: 1280, height: 800 }, document: { width: 1280, height: 800 } }],
        ["import", { importId: "i", websiteId: "w", sessions: [] }],
      ];
      for (const [call, declaration] of calls) {
        for (const tenantId of [undefined, "", "   ", " default", "default "]) {
          const answer = await ship(ctx, String(call), { ...declaration, tenantId });
          await ctx.verify(`${call} with tenant ${JSON.stringify(tenantId)} is rejected`, [same("rejected", answer.ok, false), check("naming the tenant", /tenant/i.test(answer.error), answer.error)]);
        }
      }
      const none = list((await mkt(ctx, "list the websites", "GET", "/websites")).body);
      await ctx.verify("nothing was written", [same("websites", none.length, 0)]);
    },
  },
  {
    id: "a-declared-funnel-follows-the-funnel-rules",
    title: "EnsureFunnel needs an existing website, answers created then kept, stores the steps and the window, and a split with its key and variations",
    entryPoint: "EnsureFunnel",
    async run(/** @type {Ctx} */ ctx) {
      const orphan = await ship(ctx, "funnel", { tenantId: "default", id: "orphan", websiteId: "missing", name: "Orphan", steps: [{ kind: "url", value: "/" }] });
      await ship(ctx, "website", WEBSITE);
      const steps = [{ kind: "url", value: "/pricing" }, { kind: "custom", value: "quote_submitted" }];
      const first = await ship(ctx, "funnel", { tenantId: "default", id: "quote", websiteId: "shop-site", name: "Quote request", steps, conversionWindowHours: 48 });
      const again = await ship(ctx, "funnel", { tenantId: "default", id: "quote", websiteId: "shop-site", name: "Renamed", steps: [{ kind: "url", value: "/x" }] });
      const split = await ship(ctx, "funnel", { tenantId: "default", id: "split", websiteId: "shop-site", name: "Split", steps, experiment: { key: "hero", variations: [{ key: "a", weight: 1 }, { key: "b", weight: 3 }] } });
      const sameKey = await ship(ctx, "funnel", { tenantId: "default", id: "split-2", websiteId: "shop-site", name: "Split 2", steps, experiment: { key: "hero", variations: [{ key: "a", weight: 1 }, { key: "b", weight: 1 }] } });
      const oneArm = await ship(ctx, "funnel", { tenantId: "default", id: "split-3", websiteId: "shop-site", name: "Split 3", steps, experiment: { key: "solo", variations: [{ key: "a", weight: 1 }] } });
      const noSteps = await ship(ctx, "funnel", { tenantId: "default", id: "empty", websiteId: "shop-site", name: "Empty", steps: [] });
      await ctx.verify("the declarations", [
        same("a funnel needs its website", orphan.ok, false),
        same("created, then kept", [first.status, again.status], ["created", "kept"]),
        same("a split is created in draft unless it says otherwise", split.status, "created"),
        same("an experiment key is unique per website", sameKey.ok, false),
        same("a split needs two variations", oneArm.ok, false),
        same("a funnel needs a step", noSteps.ok, false),
      ]);
      const quote = await mkt(ctx, "read the declared funnel", "GET", "/funnels/quote/results?website=shop-site");
      const splitRead = await mkt(ctx, "read the declared split", "GET", "/funnels/split/results?website=shop-site");
      await ctx.verify("what was stored", [
        same("steps, window and name of the first call", [pick(quote.body, "funnel", "steps"), num(quote.body, "funnel", "conversionWindowMs") / 3_600_000, pick(quote.body, "funnel", "name")], [steps, 48, "Quote request"]),
        same("the split", [pick(splitRead.body, "funnel", "experiment", "key"), pick(splitRead.body, "funnel", "experiment", "status"), pick(splitRead.body, "funnel", "experiment", "variations")], ["hero", "draft", [{ key: "a", weight: 1 }, { key: "b", weight: 3 }]]),
      ]);
    },
  },
  {
    id: "a-declared-snapshot-needs-a-website-that-opted-in-and-never-replaces-a-capture",
    title: "EnsurePageSnapshot needs snapshotsEnabled, is keyed by path and layout, answers created then kept, is sanitised like a capture and reads back through /stats/snapshot",
    entryPoint: "EnsurePageSnapshot",
    async run(/** @type {Ctx} */ ctx) {
      await ship(ctx, "website", { ...WEBSITE, id: "off-site", domain: "off.example.com" });
      await ship(ctx, "website", { ...WEBSITE, id: "on-site", domain: "on.example.com", snapshotsEnabled: true });
      const base = { tenantId: "default", viewport: { width: 1280, height: 800 }, document: { width: 1280, height: 2000 } };
      const html = '<body><h1 id="title">Pricing</h1><script>alert(1)</script><a href="javascript:alert(2)" onclick="x()">go</a><input value="secret-token"><style>.a{width:1px}</style><style>.b::before{content:"<b>"}</style></body>';
      const refused = await ship(ctx, "snapshot", { ...base, websiteId: "off-site", url: "https://off.example.com/pricing", html });
      const created = await ship(ctx, "snapshot", { ...base, websiteId: "on-site", url: "https://on.example.com/pricing?coupon=x#top", html });
      const kept = await ship(ctx, "snapshot", { ...base, websiteId: "on-site", url: "https://on.example.com/pricing", html: "<body>other</body>" });
      const tablet = await ship(ctx, "snapshot", { ...base, viewport: { width: 768, height: 1024 }, websiteId: "on-site", url: "https://on.example.com/pricing", html: "<body>tablet</body>" });
      await ctx.verify("which declarations are written", [same("a website that did not opt in", refused.ok, false), same("created", created.status, "created"), same("the same path and layout is kept", kept.status, "kept"), same("another layout is another key", tablet.status, "created")]);
      const read = await mkt(ctx, "read the stored snapshot", "GET", "/stats/snapshot?website=on-site&path=/pricing&layout=desktop");
      const document = JSON.stringify(read.body);
      await ctx.verify("the stored document is sanitised and is the first call's", [
        check("the heading stays", document.includes("Pricing"), document.slice(0, 200)),
        same("no script, handler, script URL or form value", [document.includes("alert(1)"), document.includes("javascript:"), document.includes("onclick"), document.includes("secret-token")], [false, false, false, false]),
        check("a style holding a markup-opening < is dropped, a plain one stays", !document.includes("content:\\\"<b>") && document.includes("width:1px"), document.slice(0, 400)),
        same("the first call's document, not the second's", document.includes("other"), false),
      ]);
    },
  },
  {
    id: "an-import-replays-history-once-through-the-collect-pipeline",
    title: "ImportAnalytics answers imported with the sessions, events and drops it replayed, then skipped for the same id; the history rolls up as live collection does; a later call for an earlier window rejects",
    entryPoint: "ImportAnalytics",
    async run(/** @type {Ctx} */ ctx) {
      await ship(ctx, "website", WEBSITE);
      const day = (/** @type {number} */ back, /** @type {number} */ minute) => new Date(Date.UTC(2026, 9, 20 - back, 9, minute)).toISOString();
      const batch = (/** @type {string} */ importId, /** @type {number} */ back) => ({
        tenantId: "default",
        importId,
        websiteId: "shop-site",
        sessions: [
          { visitor: "v1", country: "FR", events: [{ kind: "pageview", at: day(back, 0), url: "https://shop.example.com/pricing", referrer: "https://www.google.com/" }, { kind: "custom", at: day(back, 2), url: "https://shop.example.com/pricing", name: "quote_submitted" }, { kind: "pageview", at: day(back, 3), url: "ftp://bad" }] },
          { visitor: "v2", events: [{ kind: "pageview", at: day(back, 5), url: "https://shop.example.com/" }] },
        ],
      });
      const first = await fixture(ctx, "import the history", "POST", "/import", batch("history-1", 3));
      const again = await fixture(ctx, "import it again", "POST", "/import", batch("history-1", 3));
      await ctx.verify("imported, then skipped", [
        same("first", [pick(first.body, "result", "status"), pick(first.body, "result", "sessions"), pick(first.body, "result", "events"), pick(first.body, "result", "dropped")], ["imported", 2, 3, 1]),
        same("second", pick(again.body, "result", "status"), "skipped"),
      ]);
      const from = Date.UTC(2026, 9, 17), to = Date.UTC(2026, 9, 17) + 86_399_999;
      const read = await eventually(() => overview(ctx, { id: "shop-site" }, { from, to }), (answer) => num(answer.body, "totals", "pageviews") === 2);
      await ctx.verify("it rolls up like live traffic", [
        same("totals", ["pageviews", "sessions", "newVisitors", "customEvents"].map((key) => num(read.body, "totals", key)), [2, 2, 2, 1]),
        same("the channel from the referrer", pick(read.body, "topChannels"), { organic: 1, direct: 1 }),
        same("the country of the imported session", pick(read.body, "topCountries"), { FR: 1 }),
      ]);
      const stored = await rows(ctx, "marketing_events", { websiteId: "shop-site" });
      await ctx.verify("imported rows carry the import id and the history's own times", [same("import ids", [...new Set(stored.map((row) => row.importId))], ["history-1"]), same("first event time", stored.map((row) => new Date(String(row.timestamp)).toISOString()).sort()[0], day(3, 0))]);
      const earlier = await fixture(ctx, "import an earlier window", "POST", "/import", batch("history-0", 6));
      await ctx.verify("an import for an earlier window than one already applied rejects", [same("rejected", pick(earlier.body, "ok"), false)]);
      const live = await createSite(ctx);
      const answer = await collect(ctx, "a live visit", live, [pageview(live, "/x")]);
      await ctx.verify("live traffic is untouched", [same("accepted", answer.accepted, 1)]);
    },
  },
  {
    id: "the-heatmap-read-takes-a-tenant-a-path-and-a-window",
    title: "GetClickHeatmap reads the last 7 days without from and to, one website with websiteId or the tenant's websites merged, and answers the points with the total",
    entryPoint: "GetClickHeatmap",
    async run(/** @type {Ctx} */ ctx) {
      const one = await createSite(ctx, { domain: "one.example.com" });
      const two = await createSite(ctx, { domain: "two.example.com" });
      const click = (/** @type {{ id: string, domain: string }} */ site, /** @type {number} */ x) => ({ kind: "click", url: `https://${site.domain}/pricing`, data: { x, y: 0.5, dx: x, dy: 0.5, selector: "#buy", ox: 0.5, oy: 0.5, nth: 0 } });
      await collect(ctx, "clicks on the first site", one, [pageview(one, "/pricing"), click(one, 0.2), click(one, 0.2)]);
      await collect(ctx, "a click on the second site", two, [pageview(two, "/pricing"), click(two, 0.8)]);
      const read = async (/** @type {Record<string, unknown>} */ query) => fixture(ctx, "read the heatmap", "POST", "/heatmap", { tenantId: "default", path: "/pricing", ...query });
      const mine = await read({ websiteId: one.id });
      const merged = await read({});
      const old = await read({ websiteId: one.id, from: "2020-01-01T00:00:00.000Z", to: "2020-01-02T00:00:00.000Z" });
      await ctx.verify("the heatmap payload", [
        same("one website", [pick(mine.body, "result", "totalClicks"), pick(mine.body, "result", "truncated"), pick(mine.body, "result", "maxWeight")], [2, false, 2]),
        same("the anchor travels with the point", list(mine.body, "result", "points")[0]?.anchor, { selector: "#buy", ox: 0.5, oy: 0.5, nth: 0 }),
        same("the tenant's websites merged", pick(merged.body, "result", "totalClicks"), 3),
        same("a window with no clicks", [pick(old.body, "result", "totalClicks"), list(old.body, "result", "points").length], [0, 0])
      ]);
    },
  },
]);
