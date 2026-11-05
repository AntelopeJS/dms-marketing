import { same } from "../../marketing.mjs";
import { local, open, settled, waitFor } from "./tracker-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */

const BASE = "/verify-marketing/site";

/** The three pattern shapes of `data-exclude-paths` (2.installation.md, 4.usage/9.tracking.md). */
export const journeys = [
  {
    id: "each-exclude-pattern-takes-exactly-the-pages-it-names",
    title: "/x/* takes one segment below /x and neither /x nor two segments below; /x/** takes /x and everything below; /x/ takes /x; spaces around the commas are ignored",
    entryPoint: "data-exclude-paths",
    async run(/** @type {Ctx} */ ctx) {
      const site = await local(ctx);
      const patterns = ` ${BASE}/one/* , ${BASE}/tree/** ,${BASE}/exact/`;
      const tab = await open(ctx, site, "start", { attrs: { "data-exclude-paths": patterns, "data-heatmap-sample": "0" } });
      await waitFor(ctx, site, "pageview", (found) => found.length >= 1);
      for (const page of ["one", "one/a", "one/a/b", "tree", "tree/x/y", "exact", "end"]) {
        await tab.page.evaluate(`history.pushState({}, '', '${BASE}/${page}')`);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
      const counted = await waitFor(ctx, site, "pageview", (found) => found.length >= 4);
      const quiet = await settled(ctx, site, "pageview", 4);
      await ctx.verify("which pages count", [
        same("counted pages, in order", counted.map((event) => event.url), [`${BASE}/start`, `${BASE}/one`, `${BASE}/one/a/b`, `${BASE}/end`]),
        quiet,
      ]);
    },
  },
];
