import { list, mkt, reads, same } from "../../marketing.mjs";
import { eventually } from "../../site.mjs";
import { session, shop } from "./funnels-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */

/** The funnel builder and the Funnels list in the browser (4.usage/5.funnels.md). */
export const journeys = [
  {
    id: "the-funnel-builder-saves-a-funnel-that-the-list-scores-and-deletes",
    title: "the funnel builder counts the sessions at each step and saves a two-step funnel, the Funnels list scores it, and Delete removes it once its name is typed",
    knownFailures: {
      "the goal step counts 1 session": "the builder's step count always says sessions (page.marketing.builder.sessions_short), so one session reads 1 sessions",
    },
    entryPoint: "/modules/marketing/funnel-builder, /modules/marketing/funnels",
    async run(/** @type {Ctx} */ ctx) {
      const site = await shop(ctx);
      await session(ctx, site, "converted", [{ path: "/landing", ago: 60_000 }, { path: "/pricing", ago: 30_000 }]);
      await session(ctx, site, "dropped", [{ path: "/landing", ago: 60_000 }]);
      const tab = await ctx.tab();
      await tab.signIn("admin");
      await tab.goto(`/modules/marketing/funnel-builder?website=${site.id}`);
      await ctx.verify("the builder opens", [tab.visible({ role: "textbox", name: "Funnel name" }, { timeoutMs: 60_000 })], { critical: true });
      await tab.fill({ role: "textbox", name: "Funnel name" }, "Landing to pricing");
      await tab.fill({ role: "combobox", name: "Step 1 page or event" }, "/landing");
      await tab.press("Enter", { role: "combobox", name: "Step 1 page or event" });
      await tab.click({ role: "button", name: "Add a step" });
      await ctx.verify("Add a step adds step 2", [await tab.visible({ role: "combobox", name: "Step 2 page or event" })], { critical: true });
      await tab.fill({ role: "combobox", name: "Step 2 page or event" }, "/pricing");
      await tab.press("Enter", { role: "combobox", name: "Step 2 page or event" });
      await ctx.verify("the preview counts the sessions at each step", [
        await reads(tab, /combobox "Step 1 page or event": \/landing\n\s+- text: 2 sessions\n/, { name: "the first step counts 2 sessions" }),
        reads(tab, /combobox "Step 2 page or event": \/pricing\n\s+- text: 1 session\n/, { name: "the goal step counts 1 session", timeoutMs: 2_000 }),
      ]);
      await tab.click({ role: "button", name: "Save funnel" });
      const rows = () => mkt(ctx, "read the funnels list", "GET", `/funnels/rows?website=${site.id}`);
      const saved = list((await eventually(rows, (answer) => list(answer.body, "results").length === 1)).body, "results");
      await ctx.verify("the funnel is saved with its steps", [same("name and steps", saved.map((row) => [row.name, list(row, "steps").map((step) => step.label)]), [["Landing to pricing", ["/landing", "/pricing"]]])]);
      await tab.goto(`/modules/marketing/funnels?website=${site.id}`);
      await ctx.verify("the list scores it", [reads(tab, /row "Landing to pricing[^"]*50(\.0)?%[^"]*1 \/ 2[^"]*\/landing \/pricing/, { timeoutMs: 60_000 })]);
      await tab.click({ role: "button", name: "Row actions" });
      await ctx.verify("the row actions offer Delete", [await tab.visible({ role: "menuitem", name: "Delete…" })], { critical: true });
      await tab.click({ role: "menuitem", name: "Delete…" });
      await tab.fill({ role: "textbox", name: "Type Landing to pricing to confirm" }, "Landing to pricing");
      await tab.click({ role: "button", name: "Delete funnel" });
      const left = await eventually(rows, (answer) => list(answer.body, "results").length === 0);
      await ctx.verify("the funnel is gone", [same("funnels", list(left.body, "results").length, 0)]);
    },
  },
];
