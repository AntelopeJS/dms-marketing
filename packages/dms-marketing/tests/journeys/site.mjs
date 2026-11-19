import { BROWSER_UA, check, fixture, mkt, num, pick, raw, text } from "./marketing.mjs";

/**
 * @typedef {import("./marketing.mjs").Ctx} Ctx
 * @typedef {import("./marketing.mjs").Answer} Answer
 * @typedef {import("./marketing.mjs").Raw} Raw
 * @typedef {import("./marketing.mjs").Row} Row
 * @typedef {{ id: string, domain: string, name: string, answer: Answer }} Site
 */

/** The window every tenant-member read takes when it gets no `from` and `to`. */
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Registers a website through the API, the way the Websites page's Add a website does.
 *
 * @param {Ctx} ctx The journey
 * @param {{ name?: string, domain?: string, extraDomains?: string[], snapshotsEnabled?: boolean, snapshotMaskText?: boolean, as?: string }} [spec] The website
 * @returns {Promise<Site>} The website, with its id empty when the call was refused
 */
export async function createSite(ctx, spec = {}) {
  const name = spec.name ?? ctx.unique("Shop");
  const domain = spec.domain ?? `${ctx.unique("shop").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.example.com`;
  const answer = await mkt(ctx, `create the website ${name}`, "POST", "/websites", {
    body: { name, domain, extraDomains: spec.extraDomains, snapshotsEnabled: spec.snapshotsEnabled, snapshotMaskText: spec.snapshotMaskText },
    as: spec.as,
  });
  return { id: text(answer.body, "_id"), domain, name, answer };
}

/**
 * A pageview event of a tracked page.
 *
 * @param {Site} site The website
 * @param {string} path The page's path
 * @param {Row} [extra] Other fields of the event (`referrer`, `title`, `data`, `at` ...)
 * @returns {Row} The event
 */
export function pageview(site, path, extra = {}) {
  return { kind: "pageview", url: `https://${site.domain}${path}`, ...extra };
}

/**
 * A custom event of a tracked page.
 *
 * @param {Site} site The website
 * @param {string} path The page's path
 * @param {string} name The event name
 * @param {Row} [extra] Other fields of the event
 * @returns {Row} The event
 */
export function custom(site, path, name, extra = {}) {
  return { kind: "custom", url: `https://${site.domain}${path}`, name, ...extra };
}

/**
 * A click of a tracked page: the viewport and document fractions and the element anchor the heatmap projects from.
 *
 * @param {Site} site The website
 * @param {string} path The page's path
 * @param {Row} data The click's `data`
 * @returns {Row} The event
 */
export function click(site, path, data) {
  return { kind: "click", url: `https://${site.domain}${path}`, data };
}

/**
 * Sends a batch to the collector the way a tracker in a visitor's browser does: `POST /api/marketing/collect`,
 * a `text/plain` JSON body, the site's origin and a browser user agent. Every default can be overridden, and a
 * header set to `null` is left out.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the batch does
 * @param {Site | { id: string, domain: string }} site The website
 * @param {Row[]} events The events
 * @param {{ origin?: string | null, referer?: string, ua?: string | null, headers?: Record<string, string>, body?: string, website?: string, forwardedFor?: string }} [options] What differs from a real visit
 * @returns {Promise<Raw & { accepted: number, dropped: number }>} The answer, with the counts it reports
 */
export async function collect(ctx, label, site, events, options = {}) {
  /** @type {Record<string, string>} */
  const headers = { "content-type": "text/plain;charset=UTF-8" };
  const origin = options.origin === undefined ? `https://${site.domain}` : options.origin;
  if (origin !== null) headers.origin = origin;
  if (options.referer) headers.referer = options.referer;
  const ua = options.ua === undefined ? BROWSER_UA : options.ua;
  if (ua !== null) headers["user-agent"] = ua;
  if (options.forwardedFor) headers["x-forwarded-for"] = options.forwardedFor;
  Object.assign(headers, options.headers);
  const body = options.body ?? JSON.stringify({ website: options.website ?? site.id, events });
  const answer = await raw(ctx, label, { path: "/api/marketing/collect", method: "POST", headers, body });
  return { ...answer, accepted: num(answer.json, "accepted"), dropped: num(answer.json, "dropped") };
}

/**
 * Collects a batch and records that every event was accepted.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the batch does
 * @param {Site} site The website
 * @param {Row[]} events The events
 * @param {Parameters<typeof collect>[4]} [options] What differs from a real visit
 * @returns {Promise<Raw & { accepted: number, dropped: number }>} The answer
 */
export async function collected(ctx, label, site, events, options = {}) {
  const answer = await collect(ctx, label, site, events, options);
  await ctx.verify(label, [
    check("the collector answers 200", answer.status === 200, answer.status),
    check(`all ${events.length} events are accepted`, answer.accepted === events.length && answer.dropped === 0, answer.json),
  ], { critical: true });
  return answer;
}

/**
 * Reads until `accept` holds or the time runs out: the rollups are written as events arrive, and a read can come first.
 *
 * @template T
 * @param {() => Promise<T>} read One read
 * @param {(value: T) => boolean} accept Whether it shows what is awaited
 * @param {number} [timeoutMs] How long to try
 * @returns {Promise<T>} The last read
 */
export async function eventually(read, accept, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!accept(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    value = await read();
  }
  return value;
}

/**
 * The overview read of a website over a window.
 *
 * @param {Ctx} ctx The journey
 * @param {Site | { id: string }} site The website
 * @param {{ from?: number, to?: number, as?: string }} [window] The window, in epoch milliseconds
 * @returns {Promise<Answer>} The answer
 */
export function overview(ctx, site, window = {}) {
  const query = new URLSearchParams({ website: site.id });
  if (window.from !== undefined) query.set("from", new Date(window.from).toISOString());
  if (window.to !== undefined) query.set("to", new Date(window.to).toISOString());
  return mkt(ctx, `read the overview of ${site.id}`, "GET", `/stats/overview?${query}`, { as: window.as });
}

/**
 * @param {Answer} answer An answer
 * @param {...(string | number)} path A field path
 * @returns {unknown} The field
 */
export function field(answer, ...path) {
  return pick(answer.body, ...path);
}

/**
 * Runs `body` with environment variables set on the backend (it restarts on the same database before and after).
 *
 * @param {Ctx} ctx The journey
 * @param {Record<string, string>} env The variables (`VERIFY_MKT_CONFIG`, `VERIFY_MKT_TRUSTED_PROXIES`, `VERIFY_MKT_CLIENT_IP_HEADER`)
 * @param {() => Promise<void>} body What to do under that environment
 * @returns {Promise<void>}
 */
export async function withEnv(ctx, env, body) {
  const previous = { ...ctx.state.extraEnv };
  ctx.state.extraEnv = { ...previous, ...env };
  try {
    await ctx.restartBackend();
    await body();
  } finally {
    ctx.state.extraEnv = previous;
    await ctx.restartBackend();
  }
}

/**
 * Runs `body` with module options set (`trackerEnabled`, `sessionIdleTimeout` ...) and optional proxy settings.
 *
 * @param {Ctx} ctx The journey
 * @param {Record<string, unknown>} options The module's options
 * @param {() => Promise<void>} body What to do under that configuration
 * @param {{ trustedProxies?: number, clientIpHeader?: string }} [dms] The DMS auth options that matter to the collector
 * @returns {Promise<void>}
 */
export function withConfig(ctx, options, body, dms = {}) {
  /** @type {Record<string, string>} */
  const env = { VERIFY_MKT_CONFIG: JSON.stringify(options) };
  if (dms.trustedProxies !== undefined) env.VERIFY_MKT_TRUSTED_PROXIES = String(dms.trustedProxies);
  if (dms.clientIpHeader !== undefined) env.VERIFY_MKT_CLIENT_IP_HEADER = dms.clientIpHeader;
  return withEnv(ctx, env, body);
}

/**
 * Invites a member with a role of the given permissions and signs them up, so tabs and requests can act as them.
 *
 * @param {Ctx} ctx The journey
 * @param {string} name The account name
 * @param {{ permissions?: string[], asTenantOwner?: boolean, language?: string }} [spec] The role and whether the member owns the tenant
 * @returns {Promise<{ roleId: string, userId: string }>} The role and the user
 */
export async function member(ctx, name, spec = {}) {
  const invite = await fixture(ctx, `invite ${name}`, "POST", "/member", { name, permissions: spec.permissions ?? [], asTenantOwner: spec.asTenantOwner ?? false, language: spec.language ?? "en" });
  const email = text(invite.body, "email");
  const password = ctx.password();
  const signup = await ctx.api(`${name} signs up`, {
    method: "POST",
    path: "/api/auth/signup",
    body: { name, email, password, lang: spec.language ?? "en", token: text(invite.body, "token") },
    as: "anon",
  });
  const userId = text(signup.body, "user", "_id");
  ctx.addAccount(name, { email, password, userId });
  await ctx.verify(`${name} is a member`, [check("the signup answers a session", signup.status === 200 && userId !== "", signup.status)], { critical: true });
  return { roleId: text(invite.body, "roleId"), userId };
}
