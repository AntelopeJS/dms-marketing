import { guarded } from "../guard.mjs";
import { byText, check, list, mkt, num, pick, same, text } from "../marketing.mjs";
import { history } from "./parts/overview-helpers.mjs";
import { declare, results, session, shop } from "./parts/funnels-helpers.mjs";
import { journeys as window } from "./parts/funnels-window.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */

const PRICING_THEN_SIGNUP = [{ kind: "url", value: "/pricing" }, { kind: "custom", value: "signup" }];

/** Funnels: how steps match, the list, the report and the builder's rules (4.usage/5.funnels.md). */
export const journeys = guarded([
  {
    id: "steps-match-in-order-within-a-session",
    title: "a session counts for step N only if it matched steps 1 to N-1 earlier in time; a page step ignores case, query, fragment and trailing slash; the report gives sessions, rates and matches per step",
    entryPoint: "GET /api/marketing/funnels/:id/results",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await declare(ctx, site, { id: "signup", steps: PRICING_THEN_SIGNUP });
      await session(ctx, site, "in-order", [{ path: "/pricing", ago: 60_000 }, { path: "/pricing", event: "signup", ago: 30_000 }]);
      await session(ctx, site, "pricing-only", [{ path: "/pricing", ago: 50_000 }]);
      await session(ctx, site, "wrong-order", [{ path: "/pricing", event: "signup", ago: 70_000 }, { path: "/pricing", ago: 40_000 }]);
      await session(ctx, site, "signup-only", [{ path: "/home", ago: 45_000 }, { path: "/home", event: "signup", ago: 20_000 }]);
      await session(ctx, site, "spelled-differently", [{ path: "/Pricing/?plan=pro#top", ago: 55_000 }, { path: "/x", event: "signup", ago: 25_000 }]);
      const read = await results(ctx, site, "signup");
      await ctx.verify("the computation", [
        same("sessions that entered", read.total, 4),
        same("sessions per step", read.steps.map((step) => step.sessions), [4, 2]),
        same("conversion rate per step (share of the previous step)", read.steps.map((step) => step.conversionRate), [1, 0.5]),
        same("matches per step: events the step matched, in order or not", read.steps.map((step) => step.matches), [4, 4]),
      ]);
      const rows = await mkt(ctx, "read the funnels list", "GET", `/funnels/rows?website=${site.id}`);
      const row = list(rows.body, "results")[0];
      await ctx.verify("the list row", [
        same("entered, completed and conversion", [row?.entered, row?.completed, row?.conversion, row?.kind], [4, 2, 50, "funnel"]),
        same("the step pills: a page is plain, an event is outlined", row?.steps, [{ label: "/pricing" }, { label: "signup", tone: "primary", variant: "outline" }]),
      ]);
    },
  },
  {
    id: "a-trailing-star-matches-every-path-below",
    title: "a final * matches every path that starts with the rest, and nothing else",
    entryPoint: "GET /api/marketing/funnels/:id/results",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await declare(ctx, site, { id: "blog", steps: [{ kind: "url", value: "/blog/*" }] });
      for (const [visitor, path] of [["a", "/blog/post-1"], ["b", "/blog/2026/deep/post"], ["c", "/BLOG/Upper"], ["d", "/blog"], ["e", "/blogger/x"], ["f", "/about"]]) await session(ctx, site, `star-${visitor}`, [{ path, ago: 30_000 }]);
      const read = await results(ctx, site, "blog");
      await ctx.verify("which paths match", [same("sessions of the single step", read.steps.map((step) => step.sessions), [3])]);
    },
  },
  {
    id: "the-conversion-window-bounds-the-journey",
    title: "a goal reached after the conversion window does not count, one inside it does; the window defaults to 24 hours",
    entryPoint: "GET /api/marketing/funnels/:id/results",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await declare(ctx, site, { id: "short", steps: PRICING_THEN_SIGNUP, conversionWindowHours: 1 });
      await declare(ctx, site, { id: "long", steps: PRICING_THEN_SIGNUP, conversionWindowHours: 24 });
      await declare(ctx, site, { id: "default", steps: PRICING_THEN_SIGNUP });
      await history(ctx, site, [
        { visitor: "slow", daysAgo: 1, minutes: [0, 0], paths: ["/pricing", "/pricing"], custom: [] },
      ]);
      const answer = await (await import("../marketing.mjs")).fixture(ctx, "import one session whose goal comes 2 hours after its entry", "POST", "/import", {
        tenantId: "default",
        importId: "slow-goal",
        websiteId: site.id,
        sessions: [{ visitor: "gap", events: [{ kind: "pageview", at: new Date(Date.now() - 6 * 3_600_000).toISOString(), url: `https://${site.domain}/pricing` }, { kind: "custom", at: new Date(Date.now() - 4 * 3_600_000).toISOString(), url: `https://${site.domain}/pricing`, name: "signup" }] }],
      });
      await ctx.verify("the history is imported", [same("status", pick(answer.body, "result", "status"), "imported")], { critical: true });
      const short = await results(ctx, site, "short");
      const long = await results(ctx, site, "long");
      const byDefault = await results(ctx, site, "default");
      const hours = (/** @type {Awaited<ReturnType<typeof results>>} */ read) => num(read.answer.body, "funnel", "conversionWindowMs") / 3_600_000;
      await ctx.verify("the window", [
        same("windows", [hours(short), hours(long), hours(byDefault)], [1, 24, 24]),
        same("2 hours is outside a 1-hour window (the session entered, the goal is not counted)", short.steps.map((step) => step.sessions).slice(-1), [0]),
        check("2 hours is inside a 24-hour window", long.steps.map((step) => step.sessions).slice(-1)[0] === 1, long.steps),
      ]);
    },
  },
  {
    id: "the-preview-and-the-builder-rules-refuse-what-cannot-be-scored",
    title: "the preview scores unsaved steps without saving, answers 400 never 500 for 0 or 11 steps, a step of 501 characters and a window outside 1 to 720 hours",
    entryPoint: "POST /api/marketing/funnels/preview",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await session(ctx, site, "previewed", [{ path: "/pricing", ago: 20_000 }]);
      const preview = (/** @type {string} */ label, /** @type {unknown} */ steps, /** @type {number | undefined} */ hours) => mkt(ctx, label, "POST", "/funnels/preview", { body: { website: site.id, steps, conversionWindowHours: hours } });
      const step = (/** @type {string} */ value) => ({ kind: "url", value });
      const ok = await preview("one step", [step("/pricing")], 24);
      const ten = await preview("ten steps", Array.from({ length: 10 }, (_, index) => step(`/s${index}`)), 24);
      const eleven = await preview("eleven steps", Array.from({ length: 11 }, (_, index) => step(`/s${index}`)), 24);
      const none = await preview("no steps", [], 24);
      const long500 = await preview("a step of 500 characters", [step(`/${"a".repeat(499)}`)], 24);
      const long501 = await preview("a step of 501 characters", [step(`/${"a".repeat(500)}`)], 24);
      const w720 = await preview("a window of 720 hours", [step("/pricing")], 720);
      const w721 = await preview("a window of 721 hours", [step("/pricing")], 721);
      const w0 = await preview("a window of 0 hours", [step("/pricing")], 0);
      const kind = await preview("an unknown step kind", [{ kind: "scroll", value: "/x" }], 24);
      await ctx.verify("the limits", [
        same("a scored step", [ok.status, num(ok.body, "computation", "totalSessions")], [200, 1]),
        same("10 steps", ten.status, 200),
        same("11 steps", eleven.status, 400),
        same("no steps", none.status, 400),
        same("a step of 500 characters", long500.status, 200),
        same("a step of 501 characters", long501.status, 400),
        same("a window of 720 hours", w720.status, 200),
        same("721 hours", w721.status, 400),
        same("0 hours", w0.status, 400),
        same("an unknown step kind", kind.status, 400),
      ]);
      const saved = await mkt(ctx, "read the funnels list", "GET", `/funnels/rows?website=${site.id}`);
      await ctx.verify("a preview saves nothing", [same("funnels", pick(saved.body, "total"), 0)]);
    },
  },
  {
    id: "templates-suggestions-and-the-list-banner",
    title: "a website without funnels is offered up to two templates built from its own journeys, the builder suggests its pages and events, and the list banner tells what the raw events cover",
    entryPoint: "GET /api/marketing/funnels/templates, /suggestions, /winner",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      for (let index = 0; index < 3; index += 1) await session(ctx, site, `buyer-${index}`, [{ path: "/pricing", ago: 60_000 }, { path: "/checkout", event: "purchase", ago: 30_000 }]);
      await session(ctx, site, "subscriber", [{ path: "/blog", ago: 60_000 }, { path: "/blog", ago: 50_000 }, { path: "/blog", event: "subscribe", ago: 30_000 }]);
      await session(ctx, site, "reader", [{ path: "/docs", ago: 40_000 }, { path: "/docs", event: "download", ago: 30_000 }]);
      const templates = await mkt(ctx, "read the templates", "GET", `/funnels/templates?website=${site.id}`);
      await ctx.verify("the two events triggered by the most sessions, each led by the page viewed most often before it", [
        same("templates", list(templates.body).map((template) => [template.steps, template.entering]), [[[{ kind: "url", value: "/pricing" }, { kind: "custom", value: "purchase" }], 3], [[{ kind: "url", value: "/blog" }, { kind: "custom", value: "subscribe" }], 1]]),
      ]);
      const suggestions = await mkt(ctx, "read the suggestions", "GET", `/funnels/suggestions?website=${site.id}`);
      await ctx.verify("suggestions", [
        same("pages with their views", list(suggestions.body, "pages").map((entry) => [entry.value, entry.count]), [["/pricing", 3], ["/blog", 2], ["/docs", 1]]),
        same("events with their triggers", list(suggestions.body, "events").map((entry) => [entry.value, entry.count]).sort(byText), [["download", 1], ["purchase", 3], ["subscribe", 1]]),
      ]);
      await declare(ctx, site, { id: "any", steps: PRICING_THEN_SIGNUP });
      const winner = await mkt(ctx, "read the banner", "GET", `/funnels/winner?website=${site.id}`);
      await ctx.verify("the banner says the raw events do not cover the whole period", [check("a period coverage message", JSON.stringify(winner.body).includes("coverage.period_title"), winner.body)]);
    },
  },
  {
    id: "the-builder-saves-edits-and-deletes-a-funnel-under-its-rules",
    title: "a funnel saves with a name of up to 100 characters, 1 to 10 steps and a whole-hour window from 1 to 720 (24 by default); an edit without a window keeps it; deleting removes the definition and keeps the events",
    entryPoint: "POST /api/marketing/tables/funnels/new, PUT .../edit, DELETE .../delete",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      const steps = [{ kind: "url", value: "/pricing" }];
      const create = (/** @type {string} */ label, /** @type {Record<string, unknown>} */ body) => mkt(ctx, label, "POST", "/tables/funnels/new", { body: { websiteId: site.id, name: "F", steps, ...body } });
      const ok = await create("a funnel with the defaults", { name: "n".repeat(100) });
      const longName = await create("a name of 101 characters", { name: "n".repeat(101) });
      const noSteps = await create("no steps", { steps: [] });
      const eleven = await create("eleven steps", { steps: Array.from({ length: 11 }, (_, index) => ({ kind: "url", value: `/s${index}` })) });
      const long501 = await create("a step of 501 characters", { steps: [{ kind: "url", value: `/${"a".repeat(500)}` }] });
      const w0 = await create("a window of 0 hours", { conversionWindowHours: 0 });
      const w721 = await create("a window of 721 hours", { conversionWindowHours: 721 });
      const w720 = await create("a window of 720 hours", { conversionWindowHours: 720 });
      await ctx.verify("what saves and what is refused", [
        same("defaults and a name of 100 characters", ok.status, 200),
        same("refused", [longName.status, noSteps.status, eleven.status, long501.status, w0.status, w721.status], [400, 400, 400, 400, 400, 400]),
        same("720 hours", w720.status, 200),
      ]);
      const id = text(ok.body, "_id");
      const read = await results(ctx, site, id);
      await ctx.verify("the default window is 24 hours", [same("hours", num(read.answer.body, "funnel", "conversionWindowMs") / 3_600_000, 24)]);
      const edit = await mkt(ctx, "rename without a window", "PUT", `/tables/funnels/edit?id=${id}`, { body: { websiteId: site.id, name: "Renamed", steps } });
      const after = await results(ctx, site, id);
      await ctx.verify("an edit changes what it carries and keeps the window", [same("edit", edit.status, 200), same("name and window", [pick(after.answer.body, "funnel", "name"), num(after.answer.body, "funnel", "conversionWindowMs") / 3_600_000], ["Renamed", 24])]);
      await session(ctx, site, "kept", [{ path: "/pricing", ago: 20_000 }]);
      const removed = await mkt(ctx, "delete the funnel", "DELETE", `/tables/funnels/delete?id=${id}`);
      const rows = await mkt(ctx, "read the funnels list", "GET", `/funnels/rows?website=${site.id}`);
      const events = await mkt(ctx, "read the overview", "GET", `/stats/overview?website=${site.id}`);
      await ctx.verify("deleting removes the definition and keeps the events", [same("delete", removed.status, 200), same("funnels left: the other one created with 720 hours", pick(rows.body, "total"), 1), same("the pageview stays", num(events.body, "totals", "pageviews"), 1)]);
      const confirmation = await mkt(ctx, "read the delete confirmation", "GET", `/funnels/${text(w720.body, "_id")}/delete-confirmation`);
      await ctx.verify("the delete dialog is worded for the row", [check("it names the funnel", JSON.stringify(confirmation.body).includes('"F"') || JSON.stringify(confirmation.body).includes("\"F\"") || JSON.stringify(confirmation.body).includes("F"), confirmation.body)]);
    },
  },
  ...window,
]);
