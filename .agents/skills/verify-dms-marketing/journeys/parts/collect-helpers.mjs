import { check } from "../../marketing.mjs";
import { createSite } from "../../site.mjs";
import { rows } from "../../store.mjs";

/** @typedef {import("../marketing.mjs").Ctx} Ctx */
/** @typedef {import("../site.mjs").Site} Site */

export const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * The raw events stored for a website, oldest first.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @returns {Promise<Record<string, unknown>[]>} The rows
 */
export async function storedEvents(ctx, site) {
  const found = await rows(ctx, "marketing_events", { websiteId: site.id });
  return found.sort((a, b) => Number(new Date(String(a.timestamp))) - Number(new Date(String(b.timestamp))));
}

/**
 * The sessions stored for a website, oldest first.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @returns {Promise<Record<string, unknown>[]>} The rows
 */
export async function storedSessions(ctx, site) {
  const found = await rows(ctx, "marketing_sessions", { websiteId: site.id });
  return found.sort((a, b) => Number(new Date(String(a.startedAt))) - Number(new Date(String(b.startedAt))));
}

/**
 * A website that exists, as a journey's starting point.
 *
 * @param {Ctx} ctx The journey
 * @param {Parameters<typeof createSite>[1]} [spec] The website
 * @returns {Promise<Site>} The website
 */
export async function site(ctx, spec) {
  const created = await createSite(ctx, spec);
  await ctx.verify("the website exists", [check("POST /websites answers its id", created.id !== "", created.answer.body)], { critical: true });
  return created;
}
