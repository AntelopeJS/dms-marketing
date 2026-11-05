import { check, fixture, mkt, num, pick, same } from "../../marketing.mjs";
import { collect, createSite } from "../../site.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */
/** @typedef {import("../../site.mjs").Site} Site */
/** @typedef {{ kind: "url" | "custom", value: string }} Step */

/**
 * A website that exists.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<Site>} The website
 */
export async function shop(ctx) {
  const created = await createSite(ctx);
  await ctx.verify("the website exists", [check("POST /websites answers its id", created.id !== "", created.answer.body)], { critical: true });
  return created;
}

/**
 * Declares a funnel (`EnsureFunnel`, the interface's way of shipping one as code).
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {{ id: string, name?: string, steps: Step[], conversionWindowHours?: number, experiment?: unknown }} spec The funnel
 * @returns {Promise<Awaited<ReturnType<typeof fixture>>>} The answer
 */
export function declare(ctx, site, spec) {
  return fixture(ctx, `declare the funnel ${spec.id}`, "POST", "/funnel", { tenantId: "default", websiteId: site.id, name: spec.name ?? spec.id, ...spec });
}

/**
 * A visitor's session: the events in order, each `ago` milliseconds before now (within the collector's 5-minute skew).
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {string} visitor Names the visitor (its agent)
 * @param {{ path: string, event?: string, ago: number }[]} steps A pageview of `path`, or the custom event `event` on it
 * @returns {Promise<void>}
 */
export async function session(ctx, site, visitor, steps) {
  const now = Date.now();
  const events = steps.map((step) => (step.event ? { kind: "custom", url: `https://${site.domain}${step.path}`, name: step.event, at: now - step.ago } : { kind: "pageview", url: `https://${site.domain}${step.path}`, at: now - step.ago }));
  const answer = await collect(ctx, `session of ${visitor}`, site, events, { ua: `Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 ${visitor}` });
  if (answer.accepted !== events.length) await ctx.verify(`${visitor}'s events are accepted`, [same("accepted", answer.accepted, events.length)], { critical: true });
}

/**
 * The funnel's results.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {string} id The funnel
 * @param {string} [query] More query parameters
 * @returns {Promise<{ answer: Awaited<ReturnType<typeof mkt>>, steps: Record<string, unknown>[], total: number }>} The steps and the sessions that entered
 */
export async function results(ctx, site, id, query = "") {
  const answer = await mkt(ctx, `read the results of ${id}`, "GET", `/funnels/${id}/results?website=${site.id}${query}`);
  const steps = /** @type {Record<string, unknown>[]} */ (pick(answer.body, "computation", "steps") ?? []);
  return { answer, steps, total: num(answer.body, "computation", "totalSessions") };
}
