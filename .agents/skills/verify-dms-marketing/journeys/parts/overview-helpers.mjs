import { check, fixture, mkt, pick, same } from "../../marketing.mjs";
import { createSite } from "../../site.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */
/** @typedef {import("../../site.mjs").Site} Site */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The UTC midnight `daysAgo` days back.
 *
 * @param {number} daysAgo How many days back (0 is today)
 * @returns {number} Epoch milliseconds
 */
export function utcDay(daysAgo) {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - daysAgo * DAY_MS;
}

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
 * Replays sessions of given days through the live pipeline, with their own timestamps (`ImportAnalytics`).
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {{ visitor: string, daysAgo: number, minutes: number[], paths: string[], custom?: string[], referrer?: string, country?: string }[]} sessions Each session: its day, the minute of each pageview after noon, the pages
 * @returns {Promise<void>}
 */
export async function history(ctx, site, sessions) {
  const answer = await fixture(ctx, "import the history", "POST", "/import", {
    tenantId: "default",
    importId: ctx.unique("history").replace(/\W+/g, "-"),
    websiteId: site.id,
    sessions: sessions.map((entry) => ({
      visitor: entry.visitor,
      country: entry.country,
      events: [
        ...entry.minutes.map((minute, index) => ({ kind: "pageview", at: new Date(utcDay(entry.daysAgo) + 12 * 3_600_000 + minute * 60_000).toISOString(), url: `https://${site.domain}${entry.paths[index] ?? "/"}`, referrer: index === 0 ? entry.referrer : undefined })),
        ...(entry.custom ?? []).map((name) => ({ kind: "custom", at: new Date(utcDay(entry.daysAgo) + 12 * 3_600_000 + (entry.minutes.at(-1) ?? 0) * 60_000).toISOString(), url: `https://${site.domain}${entry.paths.at(-1) ?? "/"}`, name })),
      ],
    })),
  });
  await ctx.verify("the history is imported", [same("status", [answer.status, pick(answer.body, "ok"), pick(answer.body, "result", "status")], [200, true, "imported"])], { critical: true });
}

/**
 * The period parameters the DMS period scope sends: a window of UTC days and the comparison window.
 *
 * @param {number} firstDaysAgo The window's first day, in days back
 * @param {number} lastDaysAgo The window's last day, in days back
 * @param {"previous-period" | "previous-year" | "none"} [comparison] What it is compared with
 * @returns {string} The query string, without a leading separator
 */
export function period(firstDaysAgo, lastDaysAgo, comparison = "previous-period") {
  const days = firstDaysAgo - lastDaysAgo + 1;
  const iso = (/** @type {number} */ ms) => new Date(ms).toISOString();
  const bounds = `from=${iso(utcDay(firstDaysAgo))}&to=${iso(utcDay(lastDaysAgo) + DAY_MS - 1)}`;
  if (comparison === "none") return `${bounds}&comparison=none`;
  const shift = comparison === "previous-year" ? 365 : days;
  return `${bounds}&compareFrom=${iso(utcDay(firstDaysAgo + shift))}&compareTo=${iso(utcDay(lastDaysAgo + shift) + DAY_MS - 1)}&comparison=${comparison}`;
}

/**
 * A block read for a website and a period.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {string} path The block, with its own query
 * @param {string} window The period query
 * @returns {ReturnType<typeof mkt>} The answer
 */
export function block(ctx, site, path, window) {
  return mkt(ctx, `read ${path}`, "GET", `${path}${path.includes("?") ? "&" : "?"}website=${site.id}&${window}`);
}
