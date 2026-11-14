import { BROWSER_UA, check, same } from "../../marketing.mjs";
import { createSite } from "../../site.mjs";
import { rows } from "../../store.mjs";

/** @typedef {import("../../marketing.mjs").Ctx} Ctx */
/** @typedef {import("../../site.mjs").Site} Site */

/**
 * A website whose domain is the API's host, so a page served by the playground's visitor site is a tracked site.
 *
 * @param {Ctx} ctx The journey
 * @returns {Promise<Site>} The website
 */
export async function local(ctx) {
  const created = await createSite(ctx, { name: "Visitor site", domain: new URL(ctx.state.apiUrl).hostname });
  await ctx.verify("the website is the API's host", [check("POST /websites answers its id", created.id !== "", created.answer.body)], { critical: true });
  return created;
}

/** @type {WeakMap<Ctx, { browser: Promise<import("playwright-core").Browser>, contexts: Map<string, Promise<import("playwright-core").BrowserContext>> }>} */
const visitorBrowsers = new WeakMap();

/**
 * A visitor's browser context, one per account, in a browser of the journey's own that announces a desktop Chrome on every request.
 * A context's user agent or extra headers reach only the requests of a live page: the beacon a page sends as it unloads leaves with
 * `HeadlessChrome`, which the collector drops. The browser closes with the journey's.
 *
 * @param {Ctx} ctx The journey
 * @param {string} account The visitor's name
 * @returns {Promise<import("playwright-core").BrowserContext>} The context
 */
function visitorContext(ctx, account) {
  let visitor = visitorBrowsers.get(ctx);
  if (!visitor) {
    const browser = ctx.browser.browserType().launch({ headless: true, args: [`--user-agent=${BROWSER_UA}`] });
    ctx.browser.on("disconnected", () => {
      void browser.then(
        (launched) => launched.close(),
        () => undefined,
      );
    });
    visitor = { browser, contexts: new Map() };
    visitorBrowsers.set(ctx, visitor);
  }
  let context = visitor.contexts.get(account);
  if (!context) {
    context = visitor.browser.then((launched) => launched.newContext({ viewport: { width: 1280, height: 900 }, locale: "en-US", colorScheme: "light" }));
    visitor.contexts.set(account, context);
  }
  return context;
}

/**
 * Opens a visitor-site page in an anonymous browser.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {string} name The page name (its path under the visitor site)
 * @param {{ account?: string, attrs?: Record<string, string>, twice?: boolean, module?: boolean, js?: string, init?: string }} [options] The tag's attributes, a second tag, a module tag, a script, and a script run before the page
 * @returns {Promise<{ page: import("playwright-core").Page }>} The tab, on the page
 */
export async function open(ctx, site, name, options = {}) {
  const page = await (await visitorContext(ctx, options.account ?? "anon")).newPage();
  if (options.init) await page.addInitScript(options.init);
  const query = new URLSearchParams({ w: site.id });
  if (options.attrs) query.set("attrs", JSON.stringify(options.attrs));
  if (options.twice) query.set("twice", "1");
  if (options.module) query.set("module", "1");
  if (options.js) query.set("js", options.js);
  await page.goto(`${ctx.state.apiUrl}/verify-marketing/site/${name}?${query}`, { waitUntil: "load" });
  return { page };
}

/**
 * The stored events of a website, oldest first.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {string} [kind] Only this kind
 * @returns {Promise<Record<string, unknown>[]>} The rows
 */
export async function stored(ctx, site, kind) {
  const found = await rows(ctx, "marketing_events", kind ? { websiteId: site.id, kind } : { websiteId: site.id });
  return found.sort((a, b) => Number(new Date(String(a.timestamp))) - Number(new Date(String(b.timestamp))));
}

/**
 * Waits until the website has `count` stored events of a kind (beacons arrive a moment after the page acts).
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {string | undefined} kind The kind
 * @param {(events: Record<string, unknown>[]) => boolean} accept When to stop waiting
 * @param {number} [timeoutMs] How long to wait
 * @returns {Promise<Record<string, unknown>[]>} The last read
 */
export async function waitFor(ctx, site, kind, accept, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let events = await stored(ctx, site, kind);
  while (!accept(events) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    events = await stored(ctx, site, kind);
  }
  return events;
}

/**
 * Whether nothing more arrives: waits a moment, then reads again.
 *
 * @param {Ctx} ctx The journey
 * @param {Site} site The website
 * @param {string | undefined} kind The kind
 * @param {number} expected How many events there must be
 * @returns {Promise<ReturnType<typeof same>>} The check
 */
export async function settled(ctx, site, kind, expected) {
  await new Promise((resolve) => setTimeout(resolve, 2500));
  return same(`${kind ?? "all"} events after waiting`, (await stored(ctx, site, kind)).length, expected);
}
