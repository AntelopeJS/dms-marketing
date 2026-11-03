import { check, list, num, pick, same } from "../../marketing.mjs";
import { collect, collected, custom, eventually, overview, pageview, withConfig } from "../../site.mjs";
import { FIVE_MINUTES, site, storedEvents, storedSessions } from "./collect-helpers.mjs";

/** The journeys of part 3. */
export const journeys = [
  {
    id: "visitors-are-anonymous-hashes-of-the-website-the-address-and-the-agent",
    title: "the same website, address and agent make one visitor; another agent, another website or another address make another; the hash is not the address",
    entryPoint: "POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const other = await site(ctx);
      const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0";
      await collect(ctx, "visitor one", shop, [pageview(shop, "/one")]);
      await collect(ctx, "visitor one again", shop, [pageview(shop, "/two")]);
      await collect(ctx, "visitor two, another agent", shop, [pageview(shop, "/three")], { ua: firefox });
      await collect(ctx, "visitor three, another website", other, [pageview(other, "/four")]);
      const mine = await storedEvents(ctx, shop);
      const theirs = await storedEvents(ctx, other);
      const ids = mine.map((event) => String(event.visitorId));
      await ctx.verify("the visitor identity", [
        same("the same agent is one visitor", ids[0], ids[1]),
        check("another agent is another visitor", ids[2] !== ids[0], ids),
        check("another website is another visitor", String(theirs[0]?.visitorId) !== ids[0], [theirs[0]?.visitorId, ids[0]]),
        check("the id is a hex digest, not an address or an agent", ids.every((id) => /^[0-9a-f]{32,}$/.test(id)), ids),
      ]);
      const sessions = await storedSessions(ctx, shop);
      await ctx.verify("the second visitor is new, the first visit is not repeated as new", [
        same("sessions: one per visitor", sessions.length, 2),
        same("both are new visitors", sessions.map((session) => session.isNewVisitor), [true, true]),
      ]);
    },
  },
  {
    id: "a-pageview-opens-a-session-and-idle-time-ends-it",
    title: "only a pageview opens a session; a click or a scroll with no session is dropped; the idle timeout ends a session; a new campaign starts one; the client time is trusted within 5 minutes",
    entryPoint: "POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const click = { kind: "click", url: `https://${shop.domain}/a`, data: { x: 0.5, y: 0.5 } };
      const orphan = await collect(ctx, "a click from a visitor with no session", shop, [click]);
      await ctx.verify("a batch without a pageview is dropped when the visitor has no session", [same("accepted and dropped", [orphan.status, orphan.accepted, orphan.dropped], [200, 0, 1]), same("nothing stored", (await storedEvents(ctx, shop)).length, 0)]);
      await withConfig(ctx, { sessionIdleTimeout: 3000 }, async () => {
        await collected(ctx, "first pageview", shop, [pageview(shop, "/a?utm_source=news&utm_medium=email")]);
        await collected(ctx, "second pageview, same campaign", shop, [pageview(shop, "/b?utm_source=news&utm_medium=email")]);
        const sameSession = await storedSessions(ctx, shop);
        await ctx.verify("two pageviews of one campaign are one session", [same("sessions and pageviews", [sameSession.length, sameSession[0]?.pageviewsCount], [1, 2])]);
        await collected(ctx, "third pageview, another campaign", shop, [pageview(shop, "/c?utm_source=ads&utm_medium=cpc")]);
        const campaigns = await storedSessions(ctx, shop);
        await ctx.verify("a pageview with other campaign parameters starts a new session", [same("sessions", [campaigns.length, campaigns.map((session) => session.utmSource)], [2, ["news", "ads"]])]);
        await new Promise((resolve) => setTimeout(resolve, 3500));
        await collected(ctx, "a click after the idle timeout", shop, [click]);
        await collected(ctx, "a pageview after the idle timeout", shop, [pageview(shop, "/d?utm_source=ads&utm_medium=cpc")]);
        const afterIdle = await storedSessions(ctx, shop);
        await ctx.verify("a batch without a pageview joins the last session past the timeout, a pageview opens a new one", [
          same("sessions", afterIdle.length, 3),
          same("the click joined the second session", [afterIdle[1]?.eventsCount], [2]),
          same("the late pageview opened the third", [afterIdle[2]?.pageviewsCount, afterIdle[2]?.entryUrl], [1, "/d"]),
        ]);
      });
      const clockShop = await site(ctx);
      const now = Date.now();
       await collected(ctx, "a client time 4 minutes ago", clockShop, [pageview(clockShop, "/in", { at: now - 4 * 60 * 1000 })]);
       await collected(ctx, "a client time 4 minutes ahead", clockShop, [pageview(clockShop, "/ahead", { at: now + 4 * 60 * 1000 })]);
       await collected(ctx, "a client time 6 minutes ago", clockShop, [pageview(clockShop, "/out", { at: now - 6 * 60 * 1000 })]);
       await collected(ctx, "a client time 6 minutes ahead", clockShop, [pageview(clockShop, "/far", { at: now + 6 * 60 * 1000 })]);
      const events = await storedEvents(ctx, clockShop);
      const byUrl = Object.fromEntries(events.map((event) => [String(event.url), Number(new Date(String(event.timestamp)))]));
      await ctx.verify("the client time is trusted within 5 minutes of skew and ignored beyond", [
        check("4 minutes ago is kept", Math.abs((byUrl["/in"] ?? 0) - (now - 4 * 60 * 1000)) < 2000, byUrl),
        check("4 minutes ahead is kept", Math.abs((byUrl["/ahead"] ?? 0) - (now + 4 * 60 * 1000)) < 2000, byUrl),
        check("6 minutes ago is replaced by the server's time", Math.abs((byUrl["/out"] ?? 0) - now) < FIVE_MINUTES - 60 * 1000, byUrl),
        check("6 minutes ahead is replaced by the server's time", Math.abs((byUrl["/far"] ?? 0) - now) < FIVE_MINUTES - 60 * 1000, byUrl),
      ]);
    },
  },
  {
    id: "a-referrer-of-the-site-itself-is-not-a-source",
    title: "a referrer on the website's domain, or on a host the batch was tracked from, is dropped; another site's referrer is kept as its bare domain",
    entryPoint: "POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const referrers = [
        ["own", `https://${shop.domain}/home`],
        ["own with www", `https://www.${shop.domain}/home`],
        ["external", "https://www.partner.example.org/blog/post?id=7"],
      ];
      for (const [label, referrer] of referrers) {
        await collect(ctx, `referrer: ${label}`, shop, [pageview(shop, `/from-${String(label).replace(/\W+/g, "-")}`, { referrer })], { ua: `${String(label)}-browser Mozilla/5.0 Chrome/130` });
      }
      const sessions = await storedSessions(ctx, shop);
      const byEntry = Object.fromEntries(sessions.map((session) => [String(session.entryUrl), session.referrerDomain]));
      await ctx.verify("the stored referrer domain", [
        same("the site's own domain is no source", byEntry["/from-own"] ?? null, null),
        same("www of the site's own domain is no source", byEntry["/from-own-with-www"] ?? null, null),
        same("an external referrer keeps its bare domain", byEntry["/from-external"], "partner.example.org"),
      ]);
    },
  },
  {
    id: "a-pageview-keeps-only-a-sample-rate-in-its-data",
    title: "the sampling rate a pageview declares is stored, any other pageview payload is dropped and the pageview is kept",
    entryPoint: "POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const answer = await collect(ctx, "pageviews with a sample rate, a bad one and none", shop, [
        pageview(shop, "/s1", { data: { sample: 0.25 } }),
        pageview(shop, "/s2", { data: { sample: 7 } }),
        pageview(shop, "/s3", { data: { other: true } }),
        pageview(shop, "/s4"),
      ]);
      await ctx.verify("every pageview is kept", [same("accepted and dropped", [answer.accepted, answer.dropped], [4, 0])], { critical: true });
      const events = await storedEvents(ctx, shop);
      await ctx.verify("only a valid sample rate is stored", [
        same("the declared rate", events.find((event) => event.url === "/s1")?.data, { sample: 0.25 }),
        same("a rate above 1 is not kept", events.find((event) => event.url === "/s2")?.data ?? null, null),
        same("another payload is not kept", events.find((event) => event.url === "/s3")?.data ?? null, null),
      ]);
    },
  },
  {
    id: "the-overview-reads-what-the-collector-rolled-up",
    title: "the daily rollups count the events as they are written: pageviews, sessions, new visitors, custom events and the bounce of a one-page session",
    entryPoint: "POST /api/marketing/collect, GET /api/marketing/stats/overview",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const firefox = "Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0";
      await collected(ctx, "visitor one: two pageviews and a custom event", shop, [pageview(shop, "/a"), pageview(shop, "/b"), custom(shop, "/b", "signup")]);
      await collected(ctx, "visitor two: one pageview", shop, [pageview(shop, "/a")], { ua: firefox });
      const read = await eventually(() => overview(ctx, shop), (answer) => num(answer.body, "totals", "pageviews") === 3 && num(answer.body, "totals", "customEvents") === 1);
      await ctx.verify("the rollup of the day", [
        same("pageviews, sessions, new visitors, custom events", ["pageviews", "sessions", "newVisitors", "customEvents"].map((key) => num(read.body, "totals", key)), [3, 2, 2, 1]),
        same("one session bounced (the visitor who saw one page)", num(read.body, "totals", "bouncedSessions"), 1),
        same("the pages", pick(read.body, "topPages"), { "/a": 2, "/b": 1 }),
        same("the custom event", pick(read.body, "topEvents"), { signup: 1 }),
        same("one row, for today", list(read.body, "days").length, 1),
      ]);
    },
  },
];
