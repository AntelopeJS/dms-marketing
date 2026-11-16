import { check, counts, list, mkt, num, same } from "../../marketing.mjs";
import { collect, createSite, eventually, overview } from "../../site.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */
/** @typedef {import("../../site.mjs").Site} Site */
/** @typedef {{ query?: string, referrer?: string }} Visit */

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
 * Sends one pageview per visit, each from a visitor of its own (the agent differs), so each visit is one session.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {Visit[]} visits What each visitor lands on and comes from
 * @returns {Promise<void>}
 */
export async function visit(ctx, site, visits) {
  for (const [index, entry] of visits.entries()) {
    const answer = await collect(ctx, `visit ${index + 1}: ${entry.query ?? "no query"} from ${entry.referrer ?? "nowhere"}`, site, [{ kind: "pageview", url: `https://${site.domain}/landing${entry.query ?? ""}`, referrer: entry.referrer }], { ua: `Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0 visitor-${ctx.unique("v")}` });
    if (answer.accepted !== 1) await ctx.verify(`visit ${index + 1} is accepted`, [same("accepted", answer.accepted, 1)], { critical: true });
  }
}

/**
 * The sessions per channel, read once the rollups hold the sessions sent.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {number} sessions How many sessions were sent
 * @returns {Promise<Record<string, number>>} The channel counts the overview rolled up, zero channels left out
 */
export async function channels(ctx, site, sessions) {
  const read = await eventually(() => overview(ctx, site), (answer) => num(answer.body, "totals", "sessions") === sessions);
  return counts(read.body, "topChannels");
}

/**
 * The channels block: every channel with its sessions and share.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {string} [query] More query parameters
 * @returns {Promise<Awaited<ReturnType<typeof mkt>>>} The answer
 */
export function channelsBlock(ctx, site, query = "") {
  return mkt(ctx, "read the channels card", "GET", `/blocks/channels?website=${site.id}${query}`);
}

/**
 * The campaign rows of the table, as `source|medium|campaign|channel` with their sessions.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {string} [query] Search, channel filter, paging
 * @returns {Promise<{ total: number, rows: Record<string, unknown>[] }>} The page
 */
export async function campaigns(ctx, site, query = "&limit=25") {
  const answer = await mkt(ctx, "read the campaign table", "GET", `/blocks/campaigns/rows?website=${site.id}${query}`);
  return { total: num(answer.body, "total"), rows: list(answer.body, "results") };
}
