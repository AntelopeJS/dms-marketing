import { check, fixture, list, pick, same, text } from "../../marketing.mjs";
import { count } from "../../store.mjs";
import { declare, shop } from "./funnels-helpers.mjs";
import { history } from "./overview-helpers.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */
/** @typedef {import("../../site.mjs").Site} Site */

const TABLES = ["marketing_events", "marketing_sessions", "marketing_website_statistics", "marketing_funnels", "marketing_imports"];

/**
 * @param {Record<string, unknown>} row A stored row as the export or the store gives it
 * @returns {string} Its id
 */
function idOf(row) {
  return text(row, "_id") || text(row, "id");
}

/**
 * A website with a funnel and imported history: events, sessions, rollups and an applied import.
 *
 * @param {Ctx} ctx The journey
 * @param {string} funnel The funnel's id
 * @returns {Promise<Site>} The website
 */
async function workspace(ctx, funnel) {
  const site = await shop(ctx);
  const declared = await declare(ctx, site, { id: funnel, steps: [{ kind: "url", value: "/a" }, { kind: "custom", value: "signup" }] });
  await ctx.verify("the funnel is declared", [same("status", pick(declared.body, "result", "status"), "created")], { critical: true });
  await history(ctx, site, [{ visitor: "v", daysAgo: 2, minutes: [0, 1], paths: ["/a", "/b"], custom: ["signup"] }]);
  return site;
}

/**
 * The rows of the website's data, table by table.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @returns {Promise<number[]>} One count per table of TABLES, then the website rows
 */
async function counts(ctx, site) {
  const found = [];
  for (const table of TABLES) found.push(await count(ctx, table, { websiteId: site.id }));
  found.push(await count(ctx, "marketing_websites", { _id: site.id }));
  return found;
}

/** The tenant lifecycle hooks (7.architecture/2.tenancy-and-access.md). */
export const journeys = [
  {
    id: "the-workspace-export-holds-the-websites-funnels-and-rollups-and-no-captures",
    title: "the TENANT_DATA_EXPORT contribution is the marketing module's websites, funnels and rollups of the tenant; events, sessions and snapshots stay out",
    entryPoint: "Hook.TENANT_DATA_EXPORT",
    async run(/** @type {Ctx} */ ctx) {
      const site = await workspace(ctx, "exported");
      const answer = await fixture(ctx, "export the workspace", "POST", "/tenant/export", { tenantId: "default" });
      const mine = list(answer.body, "contributions").find((entry) => pick(entry, "contribution", "moduleId") === "marketing");
      const data = /** @type {Record<string, unknown>} */ (pick(mine, "contribution", "data") ?? {});
      const of = (/** @type {string} */ key) => list(data, key);
      await ctx.verify("the marketing contribution", [
        check("the module contributes under the id marketing", mine !== undefined, list(answer.body, "contributions").map((entry) => pick(entry, "contribution", "moduleId"))),
        same("its parts: websites, funnels and rollups, no events, sessions or snapshots", Object.keys(data).sort(), ["funnels", "statistics", "websites"]),
        check("the website", of("websites").some((row) => idOf(row) === site.id), of("websites").map(idOf)),
        check("the funnel with its steps", of("funnels").some((row) => idOf(row) === "exported" && Array.isArray(row.steps) && row.steps.length === 2), of("funnels").map(idOf)),
        check("the rollups of the website", of("statistics").some((row) => row.websiteId === site.id), of("statistics").length),
      ]);
    },
  },
  {
    id: "deleting-the-workspace-purges-every-marketing-table-then-its-websites",
    title: "the TENANT_DELETED handler deletes the tenant's events, sessions, rollups, funnels and applied imports, then its websites, and a second run finds nothing left",
    entryPoint: "Hook.TENANT_DELETED",
    async run(/** @type {Ctx} */ ctx) {
      const site = await workspace(ctx, "doomed");
      const before = await counts(ctx, site);
      await ctx.verify("the workspace holds data in every table", [check("events, sessions, rollups, the funnel, the import and the website are stored", before.every((found) => found > 0), Object.fromEntries([...TABLES, "marketing_websites"].map((table, index) => [table, before[index]])))], { critical: true });
      const deleted = await fixture(ctx, "delete the workspace", "POST", "/tenant/delete", { tenantId: "default" });
      const after = await counts(ctx, site);
      const again = await fixture(ctx, "delete the workspace again", "POST", "/tenant/delete", { tenantId: "default" });
      await ctx.verify("nothing of the workspace is left", [
        check("the marketing handler ran", [pick(deleted.body, "ran")].flat().length > 0, deleted.body),
        same("rows left per table", Object.fromEntries([...TABLES, "marketing_websites"].map((table, index) => [table, after[index]])), Object.fromEntries([...TABLES, "marketing_websites"].map((table) => [table, 0]))),
        same("a second deletion succeeds", again.status, 200),
      ]);
    },
  },
];
