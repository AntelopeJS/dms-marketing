import { guarded } from "../guard.mjs";
import { check, list, mkt, pick, same } from "../marketing.mjs";
import { createSite } from "../site.mjs";
import { journeys as browser } from "./parts/snapshots-browser.mjs";
import { negotiate, snapshotSite, stored, upload, visit } from "./parts/snapshots-helpers.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */

const OTHER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

/** Page snapshots: negotiation, upload and what is stored (4.usage/4.page-snapshots.md, 7.architecture/5.snapshots-and-heatmaps.md). */
export const journeys = guarded([
  ...browser,
  {
    id: "the-backend-asks-for-a-capture-only-when-it-wants-one",
    title: "the capture script goes to one visitor when the site opted in, the page has no young capture and nobody else holds the promise; every other case answers an empty script",
    entryPoint: "GET /api/marketing/snapshot.js",
    async run(/** @type {Ctx} */ ctx) {
      const off = await createSite(ctx);
      const asked = await negotiate(ctx, off);
      await ctx.verify("a site that did not opt in", [same("empty script", asked.script, "")]);
      const site = await snapshotSite(ctx);
      const first = await negotiate(ctx, site);
      await ctx.verify("a site that opted in", [
        check("the script carries a token and the config", first.token !== "" && first.script.includes("\n"), first.script.slice(0, 120)),
        same("the config: no masking, the byte cap", [first.config.maskText, first.config.maxBytes], [false, 1048576]),
      ]);
      const second = await negotiate(ctx, site, { ua: OTHER_AGENT });
      const otherLayout = await negotiate(ctx, site, { ua: OTHER_AGENT, width: 390 });
      const otherPath = await negotiate(ctx, site, { ua: OTHER_AGENT, path: "/about" });
      await ctx.verify("one visitor holds the promise for a path and a layout for a minute", [
        same("another visitor, same key: empty", second.script, ""),
        check("another layout is another key", otherLayout.token !== "", otherLayout.script.slice(0, 60)),
        check("another path is another key", otherPath.token !== "", otherPath.script.slice(0, 60)),
      ]);
      const foreign = await negotiate(ctx, site, { path: "/foreign", origin: "https://evil.example.net" });
      const bot = await negotiate(ctx, site, { path: "/bot", ua: "curl/8.5.0" });
      const noHeaders = await negotiate(ctx, site, { path: "/bare", origin: null });
      const unknown = await negotiate(ctx, site, { path: "/unknown", website: "does-not-exist" });
      const noWidth = await negotiate(ctx, site, { path: "no-slash" });
      await ctx.verify("the other cases", [
        same("a foreign origin", foreign.script, ""),
        same("declared automation", bot.script, ""),
        check("a request with neither Origin nor Referer passes this route", noHeaders.token !== "", noHeaders.script.slice(0, 60)),
        same("an unknown website", unknown.script, ""),
        same("a path that is not a path", noWidth.script, ""),
      ]);
      await mkt(ctx, "set the page snapshot masking on", "PUT", `/websites/${site.id}`, { body: { snapshotMaskText: true } });
      const masked = await negotiate(ctx, site, { path: "/masked", ua: OTHER_AGENT });
      await mkt(ctx, "pause the module", "POST", "/settings/collection", { body: { enabled: false } });
      const paused = await negotiate(ctx, site, { path: "/paused" });
      await ctx.verify("masking is part of the config; a paused module serves nothing", [same("maskText", masked.config.maskText, true), same("paused", paused.script, "")]);
    },
  },
  {
    id: "an-upload-needs-its-token-its-visitor-and-its-page",
    title: "the capture is stored when its token, visitor, session page and host match, the token is spent on use, and every refusal after the origin gate is a 200 with accepted false",
    entryPoint: "POST /api/marketing/snapshot",
    async run(/** @type {Ctx} */ ctx) {
      const site = await snapshotSite(ctx);
      await visit(ctx, site, "/pricing");
      const { token } = await negotiate(ctx, site);
      const accepted = await upload(ctx, site, { token });
      const again = await upload(ctx, site, { token });
      await ctx.verify("a valid capture, once", [same("accepted", [accepted.status, pick(accepted.json, "accepted")], [200, true]), same("the token is spent", [again.status, pick(again.json, "accepted")], [200, false])]);
      const read = await stored(ctx, site, "/pricing");
      await ctx.verify("stored under the page's origin and path, per layout", [
        same("url without query or fragment", pick(read.answer.body, "snapshot", "url"), `https://${site.domain}/pricing`),
        same("the layout and viewport", [pick(read.answer.body, "snapshot", "layout"), pick(read.answer.body, "snapshot", "viewport")], ["desktop", { width: 1280, height: 800 }]),
        check("the page", read.html.includes("Pricing"), read.html.slice(0, 200)),
      ]);
      const refusals = [];
      await visit(ctx, site, "/about");
      const aboutToken = (await negotiate(ctx, site, { path: "/about" })).token;
      refusals.push(["a token for another page", await upload(ctx, site, { token: aboutToken, url: `https://${site.domain}/pricing` })]);
      refusals.push(["a made-up token", await upload(ctx, site, { token: "forged-token", url: `https://${site.domain}/about` })]);
      const strangerToken = (await negotiate(ctx, site, { path: "/other-page", ua: OTHER_AGENT })).token;
      refusals.push(["another visitor's token", await upload(ctx, site, { token: strangerToken, url: `https://${site.domain}/other-page` })]);
      await visit(ctx, site, "/hosted", OTHER_AGENT);
      const hostedToken = (await negotiate(ctx, site, { path: "/hosted", ua: OTHER_AGENT })).token;
      refusals.push(["a page URL on a host the site does not declare", await upload(ctx, site, { token: hostedToken, url: "https://evil.example.net/hosted" }, { ua: OTHER_AGENT })]);
      refusals.push(["a request with no Origin or Referer", await upload(ctx, site, { token: hostedToken, url: `https://${site.domain}/hosted` }, { ua: OTHER_AGENT, origin: null })]);
      await ctx.verify("refused uploads answer 200 with accepted false", refusals.map(([label, answer]) => same(String(label), [answer.status, pick(answer.json, "accepted")], [200, false])));
      const foreign = await upload(ctx, site, { token: hostedToken, url: `https://${site.domain}/hosted` }, { ua: OTHER_AGENT, origin: "https://evil.example.net" });
      const unknown = await upload(ctx, site, { token: hostedToken, website: "does-not-exist" }, { ua: OTHER_AGENT });
      const invalid = await upload(ctx, site, { token: hostedToken }, { ua: OTHER_AGENT, rawBody: "{}" });
      await ctx.verify("the gates before the negotiation", [same("a foreign origin", foreign.status, 403), same("an unknown website", unknown.status, 404), same("a body that does not validate", invalid.status, 400)]);
      const noSession = await negotiate(ctx, site, { path: "/never-visited", ua: "Mozilla/5.0 Chrome/130 no-session" });
      const noSessionUpload = await upload(ctx, site, { token: noSession.token, url: `https://${site.domain}/never-visited` }, { ua: "Mozilla/5.0 Chrome/130 no-session" });
      await ctx.verify("the visitor's open session must sit on the page", [same("accepted", pick(noSessionUpload.json, "accepted"), false)]);
    },
  },
  {
    id: "uploads-are-limited-to-3-a-minute-per-source",
    title: "a fourth upload within a minute from one website and address is refused",
    entryPoint: "POST /api/marketing/snapshot",
    async run(/** @type {Ctx} */ ctx) {
      const site = await snapshotSite(ctx);
      /** @type {unknown[]} */
      const accepted = [];
      for (const [index, path] of ["/a", "/b", "/c", "/d"].entries()) {
        const ua = `Mozilla/5.0 Chrome/130 uploader-${index}`;
        await visit(ctx, site, path, ua);
        const { token } = await negotiate(ctx, site, { path, ua });
        const answer = await upload(ctx, site, { token, url: `https://${site.domain}${path}` }, { ua });
        accepted.push(pick(answer.json, "accepted"));
      }
      await ctx.verify("three, then refused", [same("accepted per upload", accepted, [true, true, true, false])]);
    },
  },
  {
    id: "the-upload-cap-is-the-configured-size-clamped-between-64-kib-and-8-mib",
    title: "a body past snapshotMaxBytes answers 413; a value below 64 KiB is raised to 64 KiB; a heavy page may report its size instead of a document",
    entryPoint: "POST /api/marketing/snapshot",
    async run(/** @type {Ctx} */ ctx) {
      const { withConfig } = await import("../site.mjs");
      const site = await snapshotSite(ctx);
      await withConfig(ctx, { snapshotMaxBytes: 1000 }, async () => {
        await visit(ctx, site, "/pricing");
        const { token, config } = await negotiate(ctx, site);
        await ctx.verify("the cap served to the capture script is clamped to 64 KiB", [same("maxBytes", config.maxBytes, 65536)]);
        const body = (/** @type {number} */ bytes) => {
          const head = JSON.stringify({ website: site.id, url: `https://${site.domain}/pricing`, viewport: { width: 1280, height: 800 }, document: { width: 1280, height: 800 }, token, html: "" });
          return JSON.stringify({ website: site.id, url: `https://${site.domain}/pricing`, viewport: { width: 1280, height: 800 }, document: { width: 1280, height: 800 }, token, html: `<body>${"x".repeat(bytes - Buffer.byteLength(head) - 13)}</body>` });
        };
        const over = await upload(ctx, site, {}, { rawBody: body(65537) });
        const exact = await upload(ctx, site, {}, { rawBody: body(65536) });
        await ctx.verify("the cap is on the body as received", [same("65,537 bytes", over.status, 413), same("65,536 bytes", [exact.status, pick(exact.json, "accepted")], [200, true])]);
      });
      await visit(ctx, site, "/heavy", "Mozilla/5.0 Chrome/130 heavy");
      const heavy = await negotiate(ctx, site, { path: "/heavy", ua: "Mozilla/5.0 Chrome/130 heavy" });
      const report = await upload(ctx, site, { token: heavy.token, url: `https://${site.domain}/heavy`, oversizeBytes: 5_000_000, html: undefined, document: undefined }, { ua: "Mozilla/5.0 Chrome/130 heavy" });
      const pages = await mkt(ctx, "read the pages", "GET", `/stats/pages?website=${site.id}`);
      const heavyPage = list(pages.body, "pages").find((page) => page.path === "/heavy");
      await ctx.verify("a page too heavy to capture says so", [same("accepted", pick(report.json, "accepted"), true), same("the list tells it is too heavy", pick(heavyPage, "snapshot", "tooHeavy"), true)]);
    },
  },
  {
    id: "the-stored-document-is-sanitised-again-on-the-server",
    title: "scripts, frames, plugins, handlers, script URLs and form values are stripped, a style that could open markup is dropped and a plain one stays, and the document opens with a Content-Security-Policy",
    entryPoint: "POST /api/marketing/snapshot",
    async run(/** @type {Ctx} */ ctx) {
      const site = await snapshotSite(ctx);
      await visit(ctx, site, "/pricing");
      const { token } = await negotiate(ctx, site);
      const html = '<body><h1>Pricing</h1><script>window.pwned = 1</script><iframe src="https://evil.example.net/"></iframe><object data="x.swf"></object><embed src="y.swf"><a href="javascript:alert(2)" onclick="steal()">go</a><img src="x.png" onerror="steal()"><input type="text" value="secret-token"><textarea>secret-note</textarea><style>.keep{width:7px}</style><style>.drop::before{content:"<b>"}</style><style>@media (width < 48rem){.x{color:red}}</style></body>';
      await upload(ctx, site, { token, html });
      const { html: out } = await stored(ctx, site, "/pricing");
      await ctx.verify("what stays and what goes", [
        check("the content stays", out.includes("<h1>Pricing</h1>"), out.slice(0, 300)),
        same("no script, frame, plugin", [/<script/i.test(out), /<iframe/i.test(out), /<object/i.test(out), /<embed/i.test(out)], [false, false, false, false]),
        same("no handler or script URL", [/onclick|onerror/i.test(out), /javascript:/i.test(out)], [false, false]),
        same("no form value", [out.includes("secret-token"), out.includes("secret-note")], [false, false]),
        same("a plain stylesheet stays, one that holds a < before a letter is dropped, a bare < stays", [out.includes("width:7px"), out.includes("content:\"<b>"), out.includes("width < 48rem")], [true, false, true]),
        check("a Content-Security-Policy in front", /Content-Security-Policy/i.test(out) && /script-src 'none'/.test(out) && /frame-src 'none'/.test(out) && /form-action 'none'/.test(out) && /base-uri 'none'/.test(out) && /object-src 'none'/.test(out), out.slice(0, 400)),
      ]);
    },
  },
  {
    id: "a-capture-is-not-refreshed-within-a-day-and-an-option-change-discards-the-captures",
    title: "once a page has a capture the backend asks for none for a day; changing Page snapshots or Mask all text discards the site's captures, other edits keep them",
    entryPoint: "GET /api/marketing/snapshot.js, PUT /api/marketing/websites/:id",
    async run(/** @type {Ctx} */ ctx) {
      const site = await snapshotSite(ctx);
      await visit(ctx, site, "/pricing");
      const { token } = await negotiate(ctx, site);
      await upload(ctx, site, { token });
      const young = await negotiate(ctx, site, { ua: OTHER_AGENT });
      await ctx.verify("a young capture is not asked for again", [same("empty script", young.script, "")]);
      const count = await mkt(ctx, "count what the option change discards", "GET", `/websites/${site.id}/deletion`);
      await ctx.verify("the deletion count includes the capture", [same("snapshots", pick(count.body, "snapshots"), 1)]);
      await mkt(ctx, "rename the website", "PUT", `/websites/${site.id}`, { body: { name: "Renamed" } });
      const kept = await stored(ctx, site, "/pricing");
      await mkt(ctx, "turn the masking on", "PUT", `/websites/${site.id}`, { body: { snapshotMaskText: true } });
      const afterMask = await stored(ctx, site, "/pricing");
      await ctx.verify("a rename keeps the capture, the masking switch discards it", [check("kept after a rename", kept.html.includes("Pricing"), kept.html.slice(0, 80)), same("gone after the switch", pick(afterMask.answer.body, "snapshot"), null)]);
      const again = await negotiate(ctx, site, { path: "/pricing", ua: "Mozilla/5.0 Chrome/130 again" });
      await ctx.verify("the page is captured again at the next sampled visit", [check("a token", again.token !== "", again.script.slice(0, 60))]);
      await visit(ctx, site, "/pricing", "Mozilla/5.0 Chrome/130 again");
      const second = await upload(ctx, site, { token: again.token }, { ua: "Mozilla/5.0 Chrome/130 again" });
      await mkt(ctx, "turn the snapshots off", "PUT", `/websites/${site.id}`, { body: { snapshotsEnabled: false } });
      const afterOff = await stored(ctx, site, "/pricing");
      await ctx.verify("turning the snapshots off discards them too", [same("the second capture was stored", pick(second.json, "accepted"), true), same("gone after the switch", pick(afterOff.answer.body, "snapshot"), null)]);
    },
  },
]);
