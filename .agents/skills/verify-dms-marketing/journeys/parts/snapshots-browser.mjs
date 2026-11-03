import { check, pick, same } from "../../marketing.mjs";
import { open, stored as storedEvents, waitFor } from "./tracker-helpers.mjs";
import { stored } from "./snapshots-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */

const PAGE_SCRIPT = `
const input = document.createElement("input");
input.type = "text"; input.value = "typed-secret"; input.id = "field";
const masked = document.createElement("p");
masked.setAttribute("data-dms-marketing-mask", ""); masked.textContent = "private words here"; masked.id = "masked";
const blocked = document.createElement("div");
blocked.setAttribute("data-dms-marketing-block", ""); blocked.id = "blocked"; blocked.className = "keep-class"; blocked.textContent = "blocked content"; blocked.style.height = "30px";
const link = document.createElement("a");
link.href = "/elsewhere?token=abc#frag"; link.textContent = "elsewhere";
document.getElementById("app").append(input, masked, blocked, link);
`;

/** The tracker and the capture script in a real browser (4.usage/9.tracking.md, 4.usage/3.pages-and-heatmaps.md). */
export const journeys = [
  {
    id: "a-sampled-visit-clicks-scrolls-and-captures-the-page-in-the-browser",
    title: "on a sampled visit a real click is stored with its element anchor, a scripted click is not, the depth is sent on leaving, and the capture masks form values, marked text and blocked elements and keeps link targets without query",
    entryPoint: "tracker.js, snapshot.js, POST /api/marketing/snapshot",
    async run(/** @type {Ctx} */ ctx) {
      const { createSite } = await import("../../site.mjs");
      const site = await createSite(ctx, { name: "Visitor site", domain: new URL(ctx.state.apiUrl).hostname, snapshotsEnabled: true });
      await ctx.verify("the website is the API's host", [check("created", site.id !== "", site.answer.body)], { critical: true });
      const tab = await open(ctx, site, "capture", { attrs: { "data-heatmap-sample": "1" }, js: PAGE_SCRIPT });
      await tab.page.setViewportSize({ width: 1280, height: 800 });
      await waitFor(ctx, site, "pageview", (found) => found.length >= 1);
      const pageview = (await storedEvents(ctx, site, "pageview"))[0];
      await tab.page.click("#buy");
      await tab.page.evaluate("document.getElementById('buy').click()");
      const clicks = await waitFor(ctx, site, "click", (found) => found.length >= 1);
      await ctx.verify("the click", [
        same("pageview declares the sampling rate", pick(pageview, "data"), { sample: 1 }),
        same("one click: the real one, not the scripted one", clicks.length, 1),
        same("anchored to the element it hit", [pick(clicks[0], "data", "selector"), pick(clicks[0], "data", "nth")], ["#buy", 0]),
        check("the position inside the element is a 0 to 1 offset", Number(pick(clicks[0], "data", "ox")) > 0 && Number(pick(clicks[0], "data", "ox")) < 1, pick(clicks[0], "data")),
      ]);
      const snapshot = await (async () => {
        const deadline = Date.now() + 45_000;
        let read = await stored(ctx, site, "/verify-marketing/site/capture");
        while (!read.html && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          read = await stored(ctx, site, "/verify-marketing/site/capture");
        }
        return read;
      })();
      await ctx.verify("the capture of the page", [
        check("a capture was stored", snapshot.html !== "", pick(snapshot.answer.body, "snapshot", "url")),
        check("the page content", snapshot.html.includes("/verify-marketing/site/capture") && snapshot.html.includes('id="buy"'), snapshot.html.slice(0, 200)),
        same("the typed value never leaves the page", snapshot.html.includes("typed-secret"), false),
        same("marked text is masked, whitespace kept", [snapshot.html.includes("private words here"), /id="masked"[^>]*>\s*x{7} x{5} x{4}/.test(snapshot.html) || snapshot.html.includes("xxxxxxx")], [false, true]),
        same("a blocked element becomes an empty box that keeps its id and class", [snapshot.html.includes("blocked content"), /id="blocked"/.test(snapshot.html), /keep-class/.test(snapshot.html)], [false, true, true]),
        same("a link keeps its target without query or fragment", [snapshot.html.includes("token=abc"), snapshot.html.includes("#frag"), snapshot.html.includes("/elsewhere")], [false, false, true]),
        same("the stored page URL is the origin and the path", pick(snapshot.answer.body, "snapshot", "url"), `${new URL(ctx.state.apiUrl).origin}/verify-marketing/site/capture`),
      ]);
      await tab.page.goto("about:blank");
      const scrolls = await waitFor(ctx, site, "scroll", (found) => found.length >= 1, 20_000);
      await ctx.verify("the depth is sent when the visitor leaves, scrolled or not", [same("one scroll event", scrolls.length, 1), check("a whole percent from 0 to 100", Number.isInteger(pick(scrolls[0], "data", "depth")), pick(scrolls[0], "data"))]);
    },
  },
];
