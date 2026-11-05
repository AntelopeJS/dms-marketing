import { check, same } from "../../marketing.mjs";
import { collect, custom, pageview } from "../../site.mjs";
import { storedEvents, storedSessions, site } from "./collect-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */
/** @typedef {import("../../site.mjs").Site} Site */

/** The journeys of part 1. */
export const journeys = [
  {
    id: "a-batch-stores-thin-events-and-says-what-it-kept",
    title: "a pageview and a custom event are stored thin: the path alone, no address, no agent, one session, and the answer counts them",
    entryPoint: "POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const answer = await collect(ctx, "a pageview and a custom event with a query string", shop, [
        pageview(shop, "/pricing?utm_source=newsletter&plan=pro#top", { title: "Pricing" }),
        custom(shop, "/pricing?plan=pro", "signup_submitted", { data: { plan: "pro" } }),
      ]);
      await ctx.verify("the answer counts both events", [
        check("200", answer.status === 200, answer.status),
        same("accepted and dropped", [answer.accepted, answer.dropped], [2, 0]),
      ], { critical: true });
      const events = await storedEvents(ctx, shop);
      const sessions = await storedSessions(ctx, shop);
      await ctx.verify("the stored events hold the path alone", [
        same("two rows", events.length, 2),
        same("kinds in order", events.map((event) => event.kind), ["pageview", "custom"]),
        same("paths without the query string or the fragment", events.map((event) => event.url), ["/pricing", "/pricing"]),
        same("the custom event keeps its name and data", [events[1]?.name, events[1]?.data], ["signup_submitted", { plan: "pro" }]),
        check("both events belong to one session", Boolean(events[0]?.sessionId) && events[0]?.sessionId === events[1]?.sessionId, events.map((event) => event.sessionId)),
        check("no row holds an address, an agent or a header", events.every((event) => Object.keys(event).every((key) => !/^(ip|ua|userAgent|headers?|address)$/i.test(key))) && sessions.every((session) => Object.keys(session).every((key) => !/^(ip|ua|userAgent|headers?|address)$/i.test(key))), events.map((event) => Object.keys(event).join(","))),
      ]);
      await ctx.verify("the session holds the campaign parameters, not the events", [
        same("one session", sessions.length, 1),
        same("its source", sessions[0]?.utmSource, "newsletter"),
        same("its entry and exit paths", [sessions[0]?.entryUrl, sessions[0]?.exitUrl], ["/pricing", "/pricing"]),
        same("one pageview and two events", [sessions[0]?.pageviewsCount, sessions[0]?.eventsCount], [1, 2]),
      ]);
    },
  },
  {
    id: "an-invalid-event-is-dropped-and-the-rest-of-the-batch-is-kept",
    title: "each failing event is dropped and counted, whatever the reason, and the rest of its batch is stored",
    entryPoint: "POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const good = pageview(shop, "/ok");
      const base = `https://${shop.domain}`;
      /** @type {[string, Record<string, unknown>][]} */
      const cases = [
        ["a url that is neither http(s) nor a path", { kind: "pageview", url: "ftp://files.example.com/x" }],
        ["an empty url", { kind: "pageview", url: "" }],
        ["a custom event without a name", { kind: "custom", url: `${base}/a` }],
        ["a custom event name of 51 characters", { kind: "custom", url: `${base}/a`, name: "n".repeat(51) }],
        ["a custom event data of 4,097 characters", { kind: "custom", url: `${base}/a`, name: "big", data: { text: "x".repeat(4097 - '{"text":""}'.length) } }],
        ["an unknown kind", { kind: "hover", url: `${base}/a` }],
        ["a click without its coordinates", { kind: "click", url: `${base}/a`, data: {} }],
        ["a click fraction above 1", { kind: "click", url: `${base}/a`, data: { x: 1.01, y: 0.5 } }],
        ["a click selector of 121 characters", { kind: "click", url: `${base}/a`, data: { x: 0.5, y: 0.5, selector: "s".repeat(121) } }],
        ["a scroll depth of 101", { kind: "scroll", url: `${base}/a`, data: { depth: 101 } }],
        ["a scroll depth with a fraction", { kind: "scroll", url: `${base}/a`, data: { depth: 50.5 } }],
        ["an exposure for a split that does not run", { kind: "exposure", url: `${base}/a`, name: "hero", data: { experiment: "hero", variation: "b" } }],
        ["an exposure name of 65 characters", { kind: "exposure", url: `${base}/a`, name: "e".repeat(65), data: { experiment: "e".repeat(65), variation: "b" } }],
        ["a non-numeric client time", { kind: "pageview", url: `${base}/a`, at: "yesterday" }],
      ];
      for (const [label, event] of cases) {
        const answer = await collect(ctx, label, shop, [good, event]);
        await ctx.verify(`${label} is dropped, the pageview next to it is kept`, [same("accepted and dropped", [answer.status, answer.accepted, answer.dropped], [200, 1, 1])]);
      }
      const events = await storedEvents(ctx, shop);
      await ctx.verify("only the good pageviews were stored", [
        same("one row per good pageview", [events.length, new Set(events.map((event) => event.kind)).size, events[0]?.url], [cases.length, 1, "/ok"]),
      ]);
    },
  },
  {
    id: "the-boundaries-of-a-batch-and-of-an-event",
    title: "25 events, a name of 50 characters, a click selector of 120 and 4,096 characters of data are kept; 26 events fail the request",
    entryPoint: "POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const batch = (/** @type {number} */ size) => Array.from({ length: size }, (_, index) => pageview(shop, `/p${index}`));
      const twentyFive = await collect(ctx, "25 events", shop, batch(25));
      const twentySix = await collect(ctx, "26 events", shop, batch(26));
      const none = await collect(ctx, "no events", shop, []);
      await ctx.verify("a batch holds 1 to 25 events", [
        same("25 events are accepted", [twentyFive.status, twentyFive.accepted, twentyFive.dropped], [200, 25, 0]),
        same("26 events fail the request", twentySix.status, 400),
        same("no event fails the request", none.status, 400),
      ]);
      const name50 = await collect(ctx, "a name of 50 characters", shop, [custom(shop, "/a", "n".repeat(50))]);
      const name51 = await collect(ctx, "a name of 51 characters", shop, [custom(shop, "/a", "n".repeat(51))]);
      const data = (/** @type {number} */ length) => ({ text: "x".repeat(length - '{"text":""}'.length) });
      const data4096 = await collect(ctx, "data of 4,096 characters", shop, [custom(shop, "/a", "big", { data: data(4096) })]);
      const data4097 = await collect(ctx, "data of 4,097 characters", shop, [custom(shop, "/a", "big", { data: data(4097) })]);
      const selector120 = await collect(ctx, "a selector of 120 characters", shop, [{ kind: "click", url: `https://${shop.domain}/a`, data: { x: 0.5, y: 0.5, selector: "s".repeat(120) } }]);
      await ctx.verify("the event caps", [
        same("a name of 50 characters is kept", name50.accepted, 1),
        same("a name of 51 characters is dropped", [name51.accepted, name51.dropped], [0, 1]),
        same("4,096 characters of serialized data are kept", data4096.accepted, 1),
        same("4,097 characters are dropped", [data4097.accepted, data4097.dropped], [0, 1]),
        same("a selector of 120 characters is kept", selector120.accepted, 1),
      ]);
      const fractions = await collect(ctx, "click fractions 0 and 1, scroll depths 0 and 100", shop, [
        { kind: "click", url: `https://${shop.domain}/a`, data: { x: 0, y: 1, dx: 1, dy: 0 } },
        { kind: "scroll", url: `https://${shop.domain}/a`, data: { depth: 0 } },
        { kind: "scroll", url: `https://${shop.domain}/a`, data: { depth: 100 } },
      ]);
      await ctx.verify("the limits of a click and of a scroll depth are kept", [same("accepted", [fractions.accepted, fractions.dropped], [3, 0])]);
    },
  },
  {
    id: "long-context-text-is-cut-not-refused",
    title: "a url and a referrer past 500 characters, a title past 200 and a screen or language past 16 are cut and the event is kept",
    entryPoint: "POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const longPath = `/${"a".repeat(600)}`;
      const answer = await collect(ctx, "an event with every context text too long", shop, [
        pageview(shop, longPath, { referrer: `https://ref.example.org/${"r".repeat(600)}`, title: "t".repeat(300), screen: "1920x1080x24-extra-long", language: "fr-FR-extra-long-tag" }),
      ]);
      await ctx.verify("the event is accepted", [same("accepted and dropped", [answer.status, answer.accepted, answer.dropped], [200, 1, 0])], { critical: true });
      const [event] = await storedEvents(ctx, shop);
      const [session] = await storedSessions(ctx, shop);
      const prefix = `https://${shop.domain}`;
      await ctx.verify("the stored texts are cut at their caps", [
        same("the url is cut at 500 characters, then reduced to its path", event?.url, longPath.slice(0, 500 - prefix.length)),
        same("the screen is cut at 16 characters", session?.screen, "1920x1080x24-ext"),
        same("the language is cut at 16 characters", session?.language, "fr-FR-extra-long"),
        same("the referrer keeps its domain", session?.referrerDomain, "ref.example.org"),
      ]);
    },
  },
  {
    id: "the-request-body-is-json-whatever-its-type-and-capped-at-256-kib",
    title: "a JSON body is read whatever its content type, anything else answers 400, and a body one byte over 256 KiB answers 413",
    entryPoint: "POST /api/marketing/collect",
    async run(/** @type {Ctx} */ ctx) {
      const shop = await site(ctx);
      const event = pageview(shop, "/body");
      const envelope = (/** @type {number} */ bytes) => {
        const head = JSON.stringify({ website: shop.id, events: [event], pad: "" });
        return JSON.stringify({ website: shop.id, events: [event], pad: "p".repeat(bytes - Buffer.byteLength(head)) });
      };
      const asText = await collect(ctx, "a JSON body sent as text/plain", shop, [event]);
      const asJson = await collect(ctx, "a JSON body sent as application/json", shop, [event], { headers: { "content-type": "application/json" } });
      const notJson = await collect(ctx, "a body that is not JSON", shop, [], { body: "not json at all" });
      const array = await collect(ctx, "a body that is a JSON array", shop, [], { body: "[]" });
      const noWebsite = await collect(ctx, "an envelope without a website", shop, [], { body: JSON.stringify({ events: [event] }) });
      const longWebsite = await collect(ctx, "a website id of 65 characters", shop, [], { body: JSON.stringify({ website: "w".repeat(65), events: [event] }) });
      await ctx.verify("the body is parsed as JSON", [
        same("text/plain", [asText.status, asText.accepted], [200, 1]),
        same("application/json", [asJson.status, asJson.accepted], [200, 1]),
        same("not JSON", notJson.status, 400),
        same("an array", array.status, 400),
        same("no website", noWebsite.status, 400),
        same("a website id past 64 characters", longWebsite.status, 400),
      ]);
      const exact = await collect(ctx, "a body of exactly 262,144 bytes", shop, [], { body: envelope(262144) });
      const over = await collect(ctx, "a body of 262,145 bytes", shop, [], { body: envelope(262145) });
      await ctx.verify("the body cap is 256 KiB", [
        same("262,144 bytes are read", [exact.status, exact.accepted], [200, 1]),
        same("262,145 bytes answer 413", over.status, 413),
      ]);
    },
  },
];
