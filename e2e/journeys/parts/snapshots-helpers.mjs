import { BROWSER_UA, check, isRow, mkt, parseJson, raw, same, text } from "../../marketing.mjs";
import { collect, createSite, pageview } from "../../site.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */
/** @typedef {import("../../site.mjs").Site} Site */

/**
 * A website with snapshots on.
 *
 * @param {Ctx} ctx The journey
 * @param {Parameters<typeof createSite>[1]} [spec] More of the website
 * @returns {Promise<Site>} The website
 */
export async function snapshotSite(ctx, spec = {}) {
  const created = await createSite(ctx, { snapshotsEnabled: true, ...spec });
  await ctx.verify("the website exists", [check("POST /websites answers its id", created.id !== "", created.answer.body)], { critical: true });
  return created;
}

/**
 * Asks the negotiation route for a capture, as a visitor's tracker does.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {{ path?: string, width?: number, ua?: string | null, origin?: string | null, website?: string, forwardedFor?: string }} [options] The request
 * @returns {Promise<{ script: string, token: string, config: Record<string, unknown> }>} The script, the token it carries and its config
 */
export async function negotiate(ctx, site, options = {}) {
  /** @type {Record<string, string>} */
  const headers = {};
  const origin = options.origin === undefined ? `https://${site.domain}` : options.origin;
  if (origin !== null) headers.origin = origin;
  const ua = options.ua === undefined ? BROWSER_UA : options.ua;
  if (ua !== null) headers["user-agent"] = ua;
  const query = new URLSearchParams({ website: options.website ?? site.id, path: options.path ?? "/pricing", width: String(options.width ?? 1280) });
  const answer = await raw(ctx, `negotiate a capture of ${options.path ?? "/pricing"} at ${options.width ?? 1280}`, { path: `/api/marketing/snapshot.js?${query}`, headers });
  const match = /^window\.__dmsMarketingSnapshotConfig=(\{.*\});/m.exec(answer.text);
  const parsed = parseJson(match?.[1] ?? "{}");
  const config = isRow(parsed) ? parsed : {};
  return { script: answer.text, token: text(config, "token"), config };
}

/**
 * Uploads a capture.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {Record<string, unknown>} body The capture, merged over a valid one
 * @param {{ origin?: string | null, ua?: string, rawBody?: string }} [options] The request
 * @returns {Promise<Awaited<ReturnType<typeof raw>>>} The answer
 */
export function upload(ctx, site, body, options = {}) {
  /** @type {Record<string, string>} */
  const headers = { "content-type": "text/plain;charset=UTF-8", "user-agent": options.ua ?? BROWSER_UA };
  const origin = options.origin === undefined ? `https://${site.domain}` : options.origin;
  if (origin !== null) headers.origin = origin;
  const capture = { website: site.id, url: `https://${site.domain}/pricing?coupon=x#top`, viewport: { width: 1280, height: 800 }, document: { width: 1280, height: 2400 }, html: "<body><h1>Pricing</h1></body>", ...body };
  return raw(ctx, "upload a capture", { path: "/api/marketing/snapshot", method: "POST", headers, body: options.rawBody ?? JSON.stringify(capture) });
}

/**
 * A visitor with an open session on a page: a pageview, as the tracker sends before it negotiates.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {string} path The page
 * @param {string} [ua] The visitor's agent
 * @returns {Promise<void>}
 */
export async function visit(ctx, site, path, ua = BROWSER_UA) {
  const answer = await collect(ctx, `a pageview of ${path}`, site, [pageview(site, path)], { ua });
  if (answer.accepted !== 1) await ctx.verify("the pageview is accepted", [same("accepted", answer.accepted, 1)], { critical: true });
}

/**
 * The stored capture of a path and layout.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {string} path The page
 * @param {string} [layout] The layout
 * @returns {Promise<{ answer: Awaited<ReturnType<typeof mkt>>, html: string }>} The answer and the stored document
 */
export async function stored(ctx, site, path, layout = "desktop") {
  const answer = await mkt(ctx, `read the capture of ${path}`, "GET", `/stats/snapshot?website=${site.id}&path=${path}&layout=${layout}`);
  const html = text(answer.body, "snapshot", "html");
  return { answer, html };
}

