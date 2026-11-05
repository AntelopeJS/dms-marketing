import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * @typedef {import("../../../packages/dms-marketing/node_modules/@antelopejs/dms/bin/control/journey.mjs").JourneyContext} Ctx
 * @typedef {import("../../../packages/dms-marketing/node_modules/@antelopejs/dms/bin/control/tab.mjs").Tab} Tab
 * @typedef {{ status: number | null, body: unknown, error: string | null, folder?: string }} Answer
 * @typedef {{ folder: string, status: number | null, headers: Record<string, string>, text: string, json: unknown }} Raw
 * @typedef {Record<string, unknown>} Row
 * @typedef {{ name: string, pass: boolean, detail: string }} Check
 */

/** The module's HTTP API. */
export const MARKETING = "/api/marketing";

/** The verification playground's trusted backend calls (`playground/src/fixture.ts`). */
export const FIXTURE = "/verify-marketing";

/** A desktop browser's user agent: the collector drops requests that announce a crawler or send none. */
export const BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

/** A second browser, for a second visitor: the visitor hash is made of the website, the address and the user agent. */
export const OTHER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is Row} Whether it is an object
 */
export function isRow(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value Anything
 * @returns {value is number} Whether it is a number
 */
function isNumber(value) {
  return typeof value === "number";
}

/**
 * @param {unknown} value Anything a JSON answer holds
 * @returns {value is string} Whether it is a string
 */
export function isText(value) {
  return typeof value === "string";
}

/**
 * Reads a nested field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...(string | number)} path The field names, outermost first
 * @returns {unknown} The field, or undefined when a step is missing
 */
export function pick(value, ...path) {
  let current = value;
  for (const step of path) {
    if (Array.isArray(current) && isNumber(step)) current = current[step];
    else if (isRow(current) && isText(step)) current = current[step];
    else return undefined;
  }
  return current;
}

/**
 * @param {unknown} value The answer
 * @param {...(string | number)} path The field names
 * @returns {string} The field when it is a string, else the empty string
 */
export function text(value, ...path) {
  const found = pick(value, ...path);
  return isText(found) ? found : "";
}

/**
 * @param {unknown} value The answer
 * @param {...(string | number)} path The field names
 * @returns {number} The field when it is a finite number, else NaN
 */
export function num(value, ...path) {
  const found = pick(value, ...path);
  return isNumber(found) && Number.isFinite(found) ? found : Number.NaN;
}

/**
 * The objects of an array field of a JSON answer.
 *
 * @param {unknown} value The answer
 * @param {...(string | number)} path The field names, outermost first
 * @returns {Row[]} The array's objects, empty when the field is not an array
 */
export function list(value, ...path) {
  const found = path.length === 0 ? value : pick(value, ...path);
  return Array.isArray(found) ? found.filter(isRow) : [];
}

/**
 * A check, in the shape `ctx.record` takes.
 *
 * @param {string} name What is checked
 * @param {unknown} pass Whether it holds
 * @param {unknown} detail What was observed
 * @returns {Check} The check
 */
export function check(name, pass, detail) {
  return { name, pass: pass === true, detail: isText(detail) ? detail : (JSON.stringify(detail) ?? "undefined") };
}

/**
 * The value with the keys of every object in order, so two objects compare equal whatever the order they were built in.
 *
 * @param {unknown} value A JSON value
 * @returns {unknown} The same value with sorted keys; undefined stays undefined
 */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (isRow(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

/**
 * An equality check over JSON values, with both sides in the detail.
 *
 * @param {string} name What is compared
 * @param {unknown} actual What was observed
 * @param {unknown} expected What is wanted
 * @returns {Check} The check
 */
export function same(name, actual, expected) {
  const [left, right] = [JSON.stringify(canonical(actual)), JSON.stringify(canonical(expected))];
  return { name, pass: left === right, detail: `expected ${right}, got ${left}` };
}

/**
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} method The HTTP method
 * @param {string} path The path under the module's API
 * @param {{ body?: unknown, as?: string }} [options] The JSON body, and the account (`admin` by default, `anon` for nobody)
 * @returns {Promise<Answer>} The answer
 */
export function mkt(ctx, label, method, path, options = {}) {
  return ctx.api(label, { method, path: `${MARKETING}${path}`, body: options.body, as: options.as });
}

/**
 * Calls the verification playground's trusted backend.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the call does
 * @param {string} method The HTTP method
 * @param {string} path The path under the fixture
 * @param {unknown} [body] The JSON body
 * @returns {Promise<Answer>} The answer
 */
export function fixture(ctx, label, method, path, body) {
  return ctx.api(label, { method, path: `${FIXTURE}${path}`, body, as: "anon" });
}

/**
 * @param {string} body A response body
 * @returns {unknown} Its JSON value, or undefined when it is not JSON
 */
export function parseJson(body) {
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/**
 * @param {Uint8Array | string} bytes Some bytes
 * @returns {string} Their SHA-256, hex
 */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The session token of an account, after one authenticated call signed it in.
 *
 * @param {Ctx} ctx The journey
 * @param {string} account The account
 * @returns {Promise<string | undefined>} The token
 */
export async function tokenOf(ctx, account) {
  if (!ctx.state.tokens?.[account]) await ctx.api(`sign ${account} in`, { method: "GET", path: `${MARKETING}/websites`, as: account });
  return ctx.state.tokens?.[account];
}

/**
 * A request to any URL with its response headers and body kept in the evidence, redirects not followed.
 *
 * @param {Ctx} ctx The journey
 * @param {string} label What the request does
 * @param {{ url?: string, path?: string, origin?: "api" | "web", method?: string, headers?: Record<string, string>, as?: string, body?: string | Buffer }} request What to send; `as` adds the account's session token
 * @returns {Promise<Raw>} The answer
 */
export async function raw(ctx, label, request) {
  const folder = ctx.step(label);
  const origin = request.origin === "web" ? ctx.state.webUrl : ctx.state.apiUrl;
  const url = request.url ?? `${origin}${request.path ?? "/"}`;
  const method = request.method ?? "GET";
  /** @type {Record<string, string>} */
  const headers = { ...request.headers };
  if (request.as) headers.authorization = `Bearer ${(await tokenOf(ctx, request.as)) ?? ""}`;
  const shown = Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, /auth|cookie/i.test(name) ? "<session>" : value]));
  const bodyBytes = request.body === undefined ? 0 : Buffer.byteLength(request.body);
  writeFileSync(join(folder, "request.json"), `${JSON.stringify({ method, url, headers: shown, bodyBytes }, null, 2)}\n`);
  const response = await fetch(url, { method, headers, redirect: "manual", body: request.body });
  const bytes = Buffer.from(await response.arrayBuffer());
  /** @type {Record<string, string>} */
  const received = {};
  for (const [name, value] of response.headers) received[name] = value;
  const body = bytes.toString("utf8");
  writeFileSync(join(folder, "response.json"), `${JSON.stringify({ status: response.status, headers: received, bytes: bytes.byteLength, sha256: sha256(bytes), body: body.slice(0, 4000) }, null, 2)}\n`);
  return { folder, status: response.status, headers: received, text: body, json: parseJson(body) };
}

/**
 * Records checks against the evidence folder `raw` made.
 *
 * @param {Ctx} ctx The journey
 * @param {Raw} answer The answer
 * @param {Check[]} checks The checks
 * @returns {boolean} Whether they all passed
 */
export function recordRaw(ctx, answer, checks) {
  return ctx.record(answer.folder, checks);
}

/**
 * Clicks until what the click opens shows: every dashboard page renders on the server and hydrates after `load`,
 * and a click that lands first does nothing.
 *
 * @param {Tab} tab The tab
 * @param {{ role: string, name: string, exact?: boolean }} target What to click
 * @param {{ role: string, name: string, exact?: boolean }} opens What must appear
 * @param {number} [attempts] How many clicks to try
 * @returns {Promise<Check>} Whether it appeared
 */
export async function clickUntil(tab, target, opens, attempts = 12) {
  /** @type {Check} */
  let last = { name: `${opens.name} opens`, pass: false, detail: "never clicked" };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await tab.click(target);
    last = await tab.visible(opens, { timeoutMs: 2500 });
    if (last.pass) return last;
  }
  return last;
}

/**
 * A compare function for sort(): orders any JSON values by their text.
 *
 * @param {unknown} a One value
 * @param {unknown} b Another
 * @returns {number} The order
 */
export function byText(a, b) {
  return (JSON.stringify(a) ?? "").localeCompare(JSON.stringify(b) ?? "");
}
