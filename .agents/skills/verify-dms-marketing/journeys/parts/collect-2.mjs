import { check, mkt, same } from "../../marketing.mjs";
import { collect, pageview, withConfig } from "../../site.mjs";
import { storedEvents, site } from "./collect-helpers.mjs";

/** The journeys of part 2. */
export const journeys = [
  {
    id: "the-browser-origin-must-be-the-website-or-a-subdomain-or-an-extra-domain",
    title: "the Origin host (else the Referer host) must be the domain, a subdomain of it or an extra domain; anything else answers 403",
    entryPoint: "POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const extra = `${ctx.unique("partner").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.example.org`;
      const shop = await site(ctx, { extraDomains: [extra] });
      const event = pageview(shop, "/origin");
      const withOrigin = async (/** @type {string} */ label, /** @type {string | null} */ origin, /** @type {Record<string, string>} */ headers = {}) => collect(ctx, label, shop, [event], { origin, headers });
      const accepted = [
        ["the domain", await withOrigin("origin: the domain", `https://${shop.domain}`)],
        ["a subdomain", await withOrigin("origin: www subdomain", `https://www.${shop.domain}`)],
        ["a deeper subdomain", await withOrigin("origin: a.b subdomain", `https://a.b.${shop.domain}`)],
        ["an extra domain", await withOrigin("origin: the extra domain", `https://${extra}`)],
        ["the domain with a port", await withOrigin("origin: the domain with a port", `https://${shop.domain}:8443`)],
        ["the domain in capitals", await withOrigin("origin: the domain in capitals", `https://${shop.domain.toUpperCase()}`)],
      ];
      const refused = [
        ["another host", await withOrigin("origin: another host", "https://evil.example.net")],
        ["a host that only ends like the domain", await withOrigin("origin: look-alike suffix", `https://evil${shop.domain}`)],
        ["the domain as a label of another host", await withOrigin("origin: domain inside another host", `https://${shop.domain}.evil.example.net`)],
        ["the opaque origin", await withOrigin("origin: null", "null")],
      ];
      await ctx.verify("hosts the website accepts", accepted.map(([label, answer]) => same(String(label), [answer.status, answer.accepted], [200, 1])));
      await ctx.verify("hosts it refuses", refused.map(([label, answer]) => same(String(label), answer.status, 403)));
      const viaReferer = await withOrigin("no origin, the website as referer", null, { referer: `https://${shop.domain}/page` });
      const viaForeignReferer = await withOrigin("no origin, another host as referer", null, { referer: "https://evil.example.net/page" });
      const originWins = await withOrigin("a foreign origin and the website as referer", "https://evil.example.net", { referer: `https://${shop.domain}/page` });
      const neither = await withOrigin("neither origin nor referer", null);
      await ctx.verify("the Referer stands in for a missing Origin", [
        same("the website as referer is accepted", [viaReferer.status, viaReferer.accepted], [200, 1]),
        same("another host as referer is refused", viaForeignReferer.status, 403),
        same("the Origin wins over the Referer", originWins.status, 403),
        same("neither header: dropped silently", [neither.status, neither.accepted, neither.dropped], [200, 0, 1]),
      ]);
      const events = await storedEvents(ctx, shop);
      await ctx.verify("only the accepted requests stored events", [same("stored events", events.length, accepted.length + 1)]);
    },
  },
  {
    id: "automation-and-missing-user-agents-are-dropped-silently",
    title: "crawlers, command-line tools, HTTP libraries and headless engines that announce themselves, and a missing user agent, answer 200 with every event dropped",
    entryPoint: "POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const event = pageview(shop, "/bots");
      const agents = [
        ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
        ["bingbot", "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)"],
        ["curl", "curl/8.5.0"],
        ["wget", "Wget/1.21.4"],
        ["python-requests", "python-requests/2.31.0"],
        ["node-fetch", "node-fetch/1.0 (+https://github.com/bitinn/node-fetch)"],
        ["HeadlessChrome", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/130.0.0.0 Safari/537.36"],
      ];
      for (const [label, ua] of agents) {
        const answer = await collect(ctx, `user agent: ${label}`, shop, [event], { ua });
        await ctx.verify(`${label} is dropped`, [same("status, accepted, dropped", [answer.status, answer.accepted, answer.dropped], [200, 0, 1])]);
      }
      const none = await collect(ctx, "no user agent", shop, [event], { ua: null, headers: { "user-agent": "" } });
      await ctx.verify("a request with no user agent is dropped", [same("status, accepted, dropped", [none.status, none.accepted, none.dropped], [200, 0, 1])]);
      const browser = await collect(ctx, "a browser", shop, [event]);
      await ctx.verify("a browser is kept, and nothing else was stored", [
        same("accepted", [browser.status, browser.accepted], [200, 1]),
        same("stored events", (await storedEvents(ctx, shop)).length, 1),
      ]);
    },
  },
  {
    id: "unknown-and-switched-off-websites-answer-404-and-a-paused-module-drops-everything",
    title: "an unknown website or a site with its tracking off answers 404; with the module's collection off every batch answers 200 and is dropped, before any website check",
    entryPoint: "POST /api/marketing/collect, PUT /api/marketing/websites/:id",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const event = pageview(shop, "/switch");
      const unknown = await collect(ctx, "an unknown website", shop, [event], { website: "does-not-exist" });
      await ctx.verify("an unknown website answers 404", [same("status", unknown.status, 404)]);
      const off = await mkt(ctx, "switch the website's tracking off", "PUT", `/websites/${shop.id}`, { body: { trackingEnabled: false } });
      const whileOff = await collect(ctx, "the website with its tracking off", shop, [event]);
      await ctx.verify("a website with its tracking off answers 404", [same("update", off.status, 200), same("collect", whileOff.status, 404)]);
      await mkt(ctx, "switch the website's tracking back on", "PUT", `/websites/${shop.id}`, { body: { trackingEnabled: true } });
      const back = await collect(ctx, "the website with its tracking on again", shop, [event]);
      await ctx.verify("switching it back on collects again", [same("accepted", [back.status, back.accepted], [200, 1])]);
      const pause = await mkt(ctx, "pause the collection of the whole module", "POST", "/settings/collection", { body: { enabled: false } });
      const paused = await collect(ctx, "a batch while the collection is paused", shop, [event, event]);
      const pausedUnknown = await collect(ctx, "an unknown website while the collection is paused", shop, [event], { website: "does-not-exist" });
      const pausedForeign = await collect(ctx, "a foreign origin while the collection is paused", shop, [event], { origin: "https://evil.example.net" });
      await ctx.verify("a paused module drops every batch with a 200", [
        same("the switch", pause.status, 200),
        same("a known website", [paused.status, paused.accepted, paused.dropped], [200, 0, 2]),
        same("an unknown website is not checked", [pausedUnknown.status, pausedUnknown.dropped], [200, 1]),
        same("a foreign origin is not checked", [pausedForeign.status, pausedForeign.dropped], [200, 1]),
      ]);
      await mkt(ctx, "resume the collection", "POST", "/settings/collection", { body: { enabled: true } });
      const resumed = await collect(ctx, "a batch after the collection resumed", shop, [event]);
      await ctx.verify("resuming collects again, and the paused batches left nothing", [
        same("accepted", [resumed.status, resumed.accepted], [200, 1]),
        same("stored events: the one after switching back on and the one after resuming", (await storedEvents(ctx, shop)).length, 2),
      ]);
    },
  },
  {
    id: "a-source-is-limited-to-600-events-a-minute",
    title: "600 events a minute are allowed per website and address; the 601st is dropped with a 200, another website and another address have their own budget",
    entryPoint: "POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const other = await site(ctx);
      const batch = (/** @type {Site} */ target, /** @type {number} */ size) => Array.from({ length: size }, (_, index) => pageview(target, `/r${index}`));
      await withConfig(ctx, {}, async () => {
        for (let sent = 0; sent < 24; sent += 1) {
          const answer = await collect(ctx, `batch ${sent + 1} of 25`, shop, batch(shop, 25));
          if (answer.accepted !== 25) {
            await ctx.verify(`batch ${sent + 1} is inside the budget`, [same("accepted", answer.accepted, 25)], { critical: true });
          }
        }
        const refused = await collect(ctx, "the 601st event", shop, batch(shop, 1));
        const otherSite = await collect(ctx, "the same address on another website", other, batch(other, 1));
        const sameDifferentAgent = await collect(ctx, "the same address with another browser", shop, batch(shop, 1), { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15" });
        await ctx.verify("the budget is 600 events per website and address", [
          same("the 601st event is dropped, with a 200", [refused.status, refused.accepted, refused.dropped], [200, 0, 1]),
          same("another website has its own budget", [otherSite.status, otherSite.accepted], [200, 1]),
          same("the budget belongs to the address, not to the browser", [sameDifferentAgent.status, sameDifferentAgent.accepted], [200, 0]),
        ]);
      }, { trustedProxies: 1 });
      const stored = await storedEvents(ctx, shop);
      await ctx.verify("exactly 600 events were stored", [same("stored events of the website", stored.length, 600)]);
    },
  },
  {
    id: "the-client-address-comes-from-trusted-proxies-only",
    title: "X-Forwarded-For is ignored with no trusted proxy, the entry the outermost trusted proxy appended is the visitor with one, and a configured header replaces the count",
    entryPoint: "POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const visitors = async (/** @type {string} */ label) => [...new Set((await storedEvents(ctx, shop)).map((event) => String(event.visitorId)))].length;
      const send = (/** @type {string} */ label, /** @type {string} */ forwarded) => collect(ctx, label, shop, [pageview(shop, `/${label.replace(/\W+/g, "-")}`)], { forwardedFor: forwarded });
      await send("no proxy: header a", "203.0.113.1");
      await send("no proxy: header b", "203.0.113.2");
      await ctx.verify("with no trusted proxy the header is a client claim and every request is the same visitor", [same("distinct visitors", await visitors("none"), 1)]);
      await withConfig(ctx, {}, async () => {
        await send("one proxy: spoof one, real one", "198.51.100.7, 203.0.113.10");
        await send("one proxy: spoof two, real one", "198.51.100.8, 203.0.113.10");
        await send("one proxy: spoof two, real two", "198.51.100.8, 203.0.113.11");
        await ctx.verify("with one trusted proxy the entry it appended is the visitor, the entries to its left are ignored", [same("distinct visitors: the proxyless one plus the two real addresses", await visitors("one"), 3)]);
      }, { trustedProxies: 1 });
      await withConfig(ctx, {}, async () => {
        await collect(ctx, "client ip header: first", shop, [pageview(shop, "/header-one")], { headers: { "x-real-client": "192.0.2.50" } });
        await collect(ctx, "client ip header: second", shop, [pageview(shop, "/header-two")], { headers: { "x-real-client": "192.0.2.51" } });
        await collect(ctx, "client ip header: first again with a forged forwarded-for", shop, [pageview(shop, "/header-three")], { headers: { "x-real-client": "192.0.2.50" }, forwardedFor: "203.0.113.99" });
        await ctx.verify("a configured header replaces the proxy count", [same("distinct visitors added by the header: two", await visitors("header"), 5)]);
      }, { clientIpHeader: "x-real-client" });
    },
  },
];
