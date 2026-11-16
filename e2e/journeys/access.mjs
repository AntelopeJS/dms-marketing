import { guarded } from "../guard.mjs";
import { mkt, same } from "../marketing.mjs";
import { createSite, member } from "../site.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */

/** @type {Record<string, readonly string[]>} In a single-tenant DMS the owner of the default tenant is the platform owner, so the two top levels meet. Who may call a route of each level (7.architecture/3.http-api.md, Auth column). */
const ALLOWED = {
  public: ["anon", "member", "towner", "admin"],
  member: ["member", "towner", "admin"],
  owner: ["towner", "admin"],
  platform: ["towner", "admin"],
};

/**
 * The routes of the HTTP surface table, with the level the docs give each.
 *
 * @param {string} site A website id
 * @param {string} funnel A funnel id
 * @returns {[string, string, string, unknown][]} Level, method, path and body
 */
function surface(site, funnel) {
  const w = `website=${site}`;
  return [
    ["public", "GET", "/tracker.js", undefined],
    ["public", "GET", `/experiments.js?${w}`, undefined],
    ["public", "GET", `/snapshot.js?${w}&path=/&width=1280`, undefined],
    ["member", "GET", "/websites", undefined],
    ["member", "GET", `/websites/${site}/connection`, undefined],
    ["member", "GET", "/context", undefined],
    ["member", "PUT", "/context", { website: site }],
    ["member", "GET", `/blocks/kpi?metric=pageviews&${w}`, undefined],
    ["member", "GET", `/blocks/traffic?metric=sessions&${w}`, undefined],
    ["member", "GET", `/blocks/quality?${w}`, undefined],
    ["member", "GET", `/blocks/devices?${w}`, undefined],
    ["member", "GET", `/blocks/tops?group=content&${w}`, undefined],
    ["member", "GET", `/blocks/top?dimension=topPages&${w}`, undefined],
    ["member", "GET", `/blocks/channels?${w}`, undefined],
    ["member", "GET", `/blocks/campaigns/rows?${w}&limit=5`, undefined],
    ["member", "GET", `/blocks/campaigns/notice?kind=tagged&${w}`, undefined],
    ["member", "GET", `/blocks/collection-notice?${w}`, undefined],
    ["member", "GET", `/blocks/website-notice?${w}`, undefined],
    ["member", "GET", `/stats/overview?${w}`, undefined],
    ["member", "GET", `/stats/pages?${w}`, undefined],
    ["member", "GET", `/stats/heatmap?${w}&path=/`, undefined],
    ["member", "GET", `/stats/scroll?${w}&path=/`, undefined],
    ["member", "GET", `/stats/snapshot?${w}&path=/&layout=desktop`, undefined],
    ["member", "GET", `/stats/workspaces?${w}`, undefined],
    ["member", "GET", `/funnels/rows?${w}`, undefined],
    ["member", "GET", `/funnels/winner?${w}`, undefined],
    ["member", "GET", `/funnels/templates?${w}`, undefined],
    ["member", "GET", `/funnels/suggestions?${w}`, undefined],
    ["member", "POST", "/funnels/preview", { website: site, steps: [{ kind: "url", value: "/" }] }],
    ["member", "GET", `/funnels/${funnel}/results?${w}`, undefined],
    ["member", "GET", `/funnels/${funnel}/delete-confirmation`, undefined],
    ["owner", "POST", "/websites", { name: "Owner made", domain: "owner-made.example.com" }],
    ["owner", "PUT", `/websites/${site}`, { name: "Renamed by owner" }],
    ["owner", "GET", `/websites/${site}/deletion`, undefined],
    ["owner", "POST", `/websites/${site}/purge`, { scope: "heatmaps" }],
    ["owner", "POST", `/websites/${site}/allow-host`, { hostname: "allowed.example.net" }],
    ["owner", "GET", `/stats/heatmap/count?${w}&path=/`, undefined],
    ["owner", "DELETE", `/stats/heatmap?${w}&path=/never`, undefined],
    ["platform", "GET", "/settings", undefined],
    ["platform", "PUT", "/settings", { heatmapSamplePercent: 10 }],
    ["platform", "GET", "/settings/collection", undefined],
    ["platform", "POST", "/settings/collection", { enabled: true }],
    ["platform", "GET", "/settings/collection/banner", undefined],
    ["platform", "GET", "/settings/glance?item=raw", undefined],
    ["platform", "GET", "/tables/funnels/list", undefined],
    ["platform", "GET", "/tables/websites/list", undefined],
  ];
}

/** Who may call what (7.architecture/2.tenancy-and-access.md, 7.architecture/3.http-api.md). */
export const journeys = guarded([
  {
    id: "every-route-answers-only-the-roles-its-level-names",
    title: "public routes answer everyone; tenant-member routes need a signed-in member; tenant-owner routes need a tenant owner; settings and the data controllers need the platform owner",
    entryPoint: "/api/marketing/*",
    async run(/** @type {Ctx} */ ctx) {
      const site = await createSite(ctx);
      const { fixture } = await import("../marketing.mjs");
      await fixture(ctx, "declare a funnel", "POST", "/funnel", { tenantId: "default", id: "access-funnel", websiteId: site.id, name: "Access", steps: [{ kind: "url", value: "/" }] });
      await member(ctx, "member");
      await member(ctx, "towner", { asTenantOwner: true });
      const accounts = ["anon", "member", "towner", "admin"];
      /** @type {string[]} */
      const wrong = [];
      for (const [level, method, path, body] of surface(site.id, "access-funnel")) {
        for (const account of accounts) {
          const answer = await mkt(ctx, `${account}: ${method} ${path}`, method, path, { body, as: account });
          const denied = answer.status === 401 || answer.status === 403;
          const mayCall = Object.entries(ALLOWED).some(([name, accounts]) => name === level && accounts.includes(account));
          if (denied === mayCall) wrong.push(`${level} ${method} ${path.split("?")[0]} as ${account}: ${answer.status}`);
        }
      }
      await ctx.verify("the access matrix", [same("calls answered against the documented level", wrong, [])]);
      const anon = await mkt(ctx, "a protected route without a session", "GET", "/websites", { as: "anon" });
      const member403 = await mkt(ctx, "a member on an owner route", "POST", "/websites", { body: { name: "x", domain: "x.example.com" }, as: "member" });
      await ctx.verify("a missing session and a missing right are not the same refusal", [same("anonymous", anon.status, 401), same("a member without the right", member403.status, 403)]);
    },
  },
]);
