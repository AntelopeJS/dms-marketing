const assert = require("node:assert/strict");
const { randomBytes, randomUUID } = require("node:crypto");
const { mkdirSync, mkdtempSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { MongoClient } = require("mongodb");
const { z } = require("zod");
const { GetModel } = require("@antelopejs/interface-database-decorators");
const { DEFAULT_TENANT_ID } = require("@antelopejs/interface-dms/constants");
const { RoleModel, UserInviteModel } = require("@antelopejs/interface-dms/db");
const { GetRegisteredHooks, Hook } = require("@antelopejs/interface-dms/hooks");
const marketing = require("@antelopejs/interface-dms-marketing");
const { setConfig } = require("../../dist/config");
const { MarketingSettingsModel } = require("../../dist/db");
const { loadSettings } = require("../../dist/services/settings");
const { forgetWebsiteSessions } = require("../../dist/services/sessionize");
const { forgetRejectedSources } = require("../../dist/services/origin-guard");
const { forgetCaptureTimes } = require("../../dist/services/snapshots");

/**
 * @typedef {{ name: string, pass: boolean, detail: string }} Check
 * @typedef {{ name: string, checks: Check[] }} Step
 * @typedef {{ email: string, password: string, userId?: string | null }} Account
 * @typedef {{ status: number | null, body: unknown, error: string | null, folder: string }} Answer
 * @typedef {{ method: string, path: string, body?: unknown, as?: string, token?: string }} ApiRequest
 * @typedef {{ id: string, title: string, run: (ctx: JourneyContext) => Promise<void>, knownFailures?: Record<string, string> }} Journey
 * @typedef {{ apiUrl: string, webUrl: string, mongoUrl: string, database: string, accounts: Record<string, Account>, tokens: Record<string, string>, extraEnv: Record<string, string> }} JourneyState
 */

const FIXTURE = "/verify-marketing";
const JOURNEY_TIMEOUT_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 30_000;
const HOOK_TIMEOUT_MS = 60_000;
/** Past every ten-minute warning window an earlier journey opened, on a clock it moved ahead included. */
const PAST_WARNED_CUTS_MS = 24 * 60 * 60_000;
const UNAUTHORIZED = 401;
const INVITE_LIFETIME_MS = 3_600_000;
/** The database `antelope.test.ts` gives the mongodb module. */
const DATABASE = "marketing_retention";
/** @returns {string} A password the DMS accepts */
function newPassword() {
  return `Vr1!${randomBytes(9).toString("base64url").replace(/[-_]/g, "x")}`;
}

const ADMIN = {
  email: "admin@journeys.local",
  password: newPassword(),
  firstName: "Journey",
  lastName: "Admin",
};
const evidence = mkdtempSync(path.join(tmpdir(), "dms-marketing-journeys-"));
const realNow = Date.now.bind(Date);

/** @type {Promise<void> | undefined} */
let onboarded;

/**
 * @param {string} name An environment variable `antelope.test.ts` sets
 * @returns {string} Its value
 */
function env(name) {
  const value = process.env[name];
  assert.ok(value, `${name} is set by antelope.test.ts`);
  return value;
}

/**
 * @param {string} text A label
 * @returns {string} Its kebab-case form, at most 60 characters
 */
function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/**
 * @param {string} text A response body
 * @returns {unknown} Its JSON value, else the text
 */
function parseBody(text) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * @param {{ url: string, method: string, body?: unknown, token?: string }} request
 * @returns {Promise<{ status: number | null, body: unknown, error: string | null }>}
 */
async function send(request) {
  /** @type {Record<string, string>} */
  const headers = { accept: "application/json" };
  if (request.body !== undefined) headers["content-type"] = "application/json";
  if (request.token) headers.authorization = `Bearer ${request.token}`;
  try {
    const response = await fetch(request.url, {
      method: request.method,
      headers,
      body:
        request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return {
      status: response.status,
      body: parseBody(await response.text()),
      error: null,
    };
  } catch (error) {
    return { status: null, body: null, error: String(error) };
  }
}

/**
 * Registers the platform owner once per process: every journey shares the
 * DMS users of the suite's database, as a run's journeys share its accounts.
 *
 * @returns {Promise<void>}
 */
function onboardOnce() {
  onboarded ??= send({
    url: `${env("TEST_API_URL")}/api/onboarding/register`,
    method: "POST",
    body: {
      ...ADMIN,
      setupToken: env("DMS_SETUP_TOKEN"),
      platformName: "Marketing journeys",
    },
  }).then((answer) => {
    assert.equal(
      answer.status,
      200,
      `the owner registers: ${JSON.stringify(answer.body)}`,
    );
  });
  return onboarded;
}

/**
 * Runs `body` against the suite's database.
 *
 * @template T
 * @param {(database: import("mongodb").Db) => Promise<T>} body
 * @returns {Promise<T>}
 */
async function withDatabase(body) {
  const client = new MongoClient(env("TEST_MONGO_URL"), {
    serverSelectionTimeoutMS: 5000,
  });
  await client.connect();
  try {
    return await body(client.db(DATABASE));
  } finally {
    await client.close();
  }
}

/**
 * Saves the settings unchanged with the clock past every warning window, so
 * no retention cut an earlier journey was warned about passes unwarned: the
 * owner of every journey is the same user, where a run gave each journey its
 * own backend and its own owner.
 *
 * @returns {Promise<void>}
 */
async function expireWarnedCuts() {
  const ctx = new JourneyContext("setup", "expire-warned-cuts");
  Date.now = () => realNow() + PAST_WARNED_CUTS_MS;
  try {
    const saved = await ctx.api("save the settings unchanged", {
      method: "PUT",
      path: "/api/marketing/settings",
      body: {},
    });
    assert.equal(
      saved.status,
      200,
      `the settings save: ${JSON.stringify(saved.body)}`,
    );
  } finally {
    Date.now = realNow;
  }
}

/**
 * Empties every marketing table, so each journey starts from the module's
 * first start as a fresh database gives it.
 *
 * @returns {Promise<void>}
 */
function emptyMarketingTables() {
  return withDatabase(async (database) => {
    const collections = await database.listCollections().toArray();
    for (const { name } of collections.filter((entry) =>
      entry.name.includes("marketing_"),
    )) {
      await database.collection(name).deleteMany({});
    }
  });
}

/**
 * @returns {Promise<string[]>} The id of every stored website
 */
function websiteIds() {
  return withDatabase(async (database) => {
    const collections = await database.listCollections().toArray();
    const ids = [];
    for (const { name } of collections.filter((entry) =>
      entry.name.endsWith("marketing_websites"),
    )) {
      for (const row of await database
        .collection(name)
        .find({}, { projection: { _id: 1 } })
        .toArray())
        ids.push(String(row._id));
    }
    return ids;
  });
}

/**
 * @param {unknown} value A module's exports
 * @returns {value is { getAuthConfig: () => unknown }} Whether they hold the dms config state's auth getter
 */
function isDmsConfigState(value) {
  return (
    value instanceof Object &&
    "getAuthConfig" in value &&
    value.getAuthConfig instanceof Function
  );
}

/**
 * @param {unknown} value What the auth getter answers
 * @returns {value is { trustedProxies?: number, clientIpHeader?: string }} Whether it is an object whose proxy fields are absent or of their type
 */
function isAuthConfig(value) {
  if (!(value instanceof Object)) return false;
  const { trustedProxies, clientIpHeader } = Object.fromEntries(
    Object.entries(value),
  );
  return (
    (trustedProxies === undefined || typeof trustedProxies === "number") &&
    (clientIpHeader === undefined || typeof clientIpHeader === "string")
  );
}

/**
 * The DMS auth config the running dms module reads on every request, for the
 * trusted proxies a journey sets before a restart.
 *
 * @returns {{ trustedProxies?: number, clientIpHeader?: string }}
 */
function dmsAuthConfig() {
  for (const loaded of Object.values(require.cache)) {
    /** @type {unknown} */
    const exported = loaded?.exports;
    const isState =
      loaded?.filename.endsWith(
        path.join("dist", "config", "internal", "state.js"),
      ) === true;
    const auth =
      isState && isDmsConfigState(exported)
        ? exported.getAuthConfig()
        : undefined;
    if (isAuthConfig(auth)) return auth;
  }
  throw new Error("the dms module's config state is not loaded");
}

/** @type {Record<string, (body: Record<string, unknown>) => Promise<unknown>>} */
const ENSURE = {
  "/website": (body) => marketing.EnsureWebsite(body),
  "/funnel": (body) => marketing.EnsureFunnel(body),
  "/snapshot": (body) => marketing.EnsurePageSnapshot(body),
  "/import": (body) => marketing.ImportAnalytics(body),
  "/heatmap": (body) => marketing.GetClickHeatmap(heatmapSchema.parse(body)),
};

const memberSchema = z.object({
  name: z.string(),
  permissions: z.array(z.string()).default([]),
  asTenantOwner: z.boolean().default(false),
  language: z.string().default("en"),
});
const heatmapSchema = z.object({
  tenantId: z.string(),
  path: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  websiteId: z.string().optional(),
});
const tenantSchema = z.object({ tenantId: z.string() });
const clockSchema = z.object({ aheadMs: z.number().int().min(0) });

/**
 * @param {string[]} permissions The permission ids of a role
 * @returns {string[]} The same ids with every id their grants sit under
 */
function withAncestors(permissions) {
  return [
    ...new Set(
      permissions.flatMap((id) =>
        id
          .split(".")
          .map((_, index, segments) => segments.slice(0, index + 1).join(".")),
      ),
    ),
  ];
}

/**
 * @param {() => Promise<unknown>} call A content call
 * @returns {Promise<{ ok: true, result: unknown } | { ok: false, error: string }>}
 */
async function outcome(call) {
  try {
    return { ok: true, result: await call() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The trusted backend calls of the verification playground's fixture module
 * (`/verify-marketing`), made in process: members with a role, the
 * interface's content calls, the tenant hooks and the backend clock.
 *
 * @param {string} method
 * @param {string} path The path under `/verify-marketing`
 * @param {unknown} body
 * @returns {Promise<unknown>} What the route answers
 */
async function fixture(method, path, body) {
  const input = z.record(z.unknown()).catch({}).parse(body);
  if (method === "GET" && path === "/tenant")
    return { tenantId: DEFAULT_TENANT_ID };
  if (method !== "POST") throw new Error(`no fixture route ${method} ${path}`);
  const ensure = ENSURE[path];
  if (ensure) return outcome(() => ensure(input));
  if (path === "/member") {
    const { name, permissions, asTenantOwner, language } =
      memberSchema.parse(input);
    const [roleId] = await GetModel(RoleModel, DEFAULT_TENANT_ID).insert({
      name: `${name} ${randomUUID()}`,
      permissions: withAncestors(permissions),
    });
    const token = randomUUID();
    const email = `${name.toLowerCase()}-${randomUUID()}@verify.local`;
    await GetModel(UserInviteModel, DEFAULT_TENANT_ID).insert({
      email,
      roles_ids: roleId === undefined ? [] : [roleId],
      language,
      token,
      asTenantOwner,
      expiresAt: new Date(Date.now() + INVITE_LIFETIME_MS),
    });
    return { email, token, roleId };
  }
  if (path === "/tenant/export") {
    const { tenantId } = tenantSchema.parse(input);
    const contributions = [];
    for (const contributor of GetRegisteredHooks(Hook.TENANT_DATA_EXPORT)) {
      /** @type {{ path: string, data: unknown }[]} */
      const entries = [];
      const archive = {
        /** @param {string} entry @param {unknown} data */
        addJson: (entry, data) =>
          Promise.resolve(void entries.push({ path: entry, data })),
        /** @param {string} entry */
        addFile: (entry) => Promise.reject(new Error(`file entry ${entry}`)),
        /** @param {string} entry */
        addStream: (entry) =>
          Promise.reject(new Error(`stream entry ${entry}`)),
      };
      const contribution = await contributor.handler(
        tenantId,
        archive,
        new AbortController().signal,
      );
      contributions.push({
        registeredBy: contributor.moduleId,
        contribution,
        entries,
      });
    }
    return { contributions };
  }
  if (path === "/tenant/delete") {
    const { tenantId } = tenantSchema.parse(input);
    const handlers = GetRegisteredHooks(Hook.TENANT_DELETED).filter(
      (hook) => hook.moduleId?.includes("marketing") === true,
    );
    for (const hook of handlers) await hook.handler(tenantId);
    return { ran: handlers.map((hook) => hook.moduleId) };
  }
  if (path === "/clock") {
    const { aheadMs } = clockSchema.parse(input);
    Date.now = () => realNow() + aheadMs;
    return { aheadMs, now: Date.now() };
  }
  throw new Error(`no fixture route ${method} ${path}`);
}

/**
 * What a restart of the backend gives the marketing module, in process: the
 * configuration a journey set, the DMS's trusted proxies, the settings read
 * again from the database as at start, and no in-memory session, refused
 * host or capture time left over.
 *
 * @param {Record<string, string>} extraEnv The variables a journey set (`VERIFY_MKT_CONFIG`, `VERIFY_MKT_TRUSTED_PROXIES`, `VERIFY_MKT_CLIENT_IP_HEADER`)
 * @returns {Promise<void>}
 */
async function restartMarketing(extraEnv) {
  setConfig(
    z.record(z.unknown()).parse(parseBody(extraEnv.VERIFY_MKT_CONFIG ?? "{}")),
  );
  const auth = dmsAuthConfig();
  const proxies = extraEnv.VERIFY_MKT_TRUSTED_PROXIES;
  auth.trustedProxies = proxies === undefined ? undefined : Number(proxies);
  auth.clientIpHeader = extraEnv.VERIFY_MKT_CLIENT_IP_HEADER || undefined;
  await loadSettings(GetModel(MarketingSettingsModel));
  for (const id of await websiteIds()) {
    forgetWebsiteSessions(id);
    forgetRejectedSources(id);
  }
  forgetCaptureTimes();
}

/**
 * The context a journey drives the backend through, as the e2e kit's
 * `JourneyContext` gives it, for journeys that call only the HTTP API and
 * the database: `api`, `verify`, `record`, `restartBackend` and the accounts.
 * A journey that opens a tab fails on the missing `tab`.
 */
class JourneyContext {
  /**
   * @param {string} feature
   * @param {string} journey
   */
  constructor(feature, journey) {
    const apiUrl = env("TEST_API_URL");
    /** @type {JourneyState} */
    this.state = {
      apiUrl,
      webUrl: apiUrl,
      mongoUrl: env("TEST_MONGO_URL"),
      database: DATABASE,
      accounts: { admin: { email: ADMIN.email, password: ADMIN.password } },
      tokens: {},
      extraEnv: {},
    };
    this.folder = path.join(evidence, feature, journey);
    /** @type {Step[]} */
    this.steps = [];
    this.index = 0;
  }

  /**
   * @param {string} label What the step does
   * @returns {string} A new folder for its evidence
   */
  step(label) {
    this.index += 1;
    const folder = path.join(
      this.folder,
      `${String(this.index).padStart(2, "0")}-${slug(label)}`,
    );
    mkdirSync(folder, { recursive: true });
    return folder;
  }

  /**
   * @param {string} folder The step's folder
   * @param {Check[]} checks
   * @param {{ critical?: boolean }} [options] A failing critical step ends the journey
   * @returns {boolean} Whether every check passed
   */
  record(folder, checks, options = {}) {
    this.steps.push({ name: folder.slice(this.folder.length + 1), checks });
    const passed = checks.every((check) => check.pass);
    if (!passed && options.critical)
      throw new CriticalStep(folder.slice(this.folder.length + 1));
    return passed;
  }

  /**
   * @param {string} label
   * @param {(Check | Promise<Check>)[]} checks
   * @param {{ critical?: boolean }} [options]
   * @returns {Promise<boolean>}
   */
  async verify(label, checks, options = {}) {
    return this.record(
      this.step(label),
      await Promise.all(checks.map((check) => Promise.resolve(check))),
      options,
    );
  }

  /**
   * @param {string} account
   * @returns {Promise<void>}
   */
  async signIn(account) {
    const credentials = this.state.accounts[account];
    if (!credentials) throw new Error(`no account ${account}`);
    const answer = await send({
      url: `${this.state.apiUrl}/api/auth/login`,
      method: "POST",
      body: { email: credentials.email, password: credentials.password },
    });
    const session = z
      .object({ access_token: z.string() })
      .safeParse(answer.body);
    if (session.success) this.state.tokens[account] = session.data.access_token;
  }

  /**
   * Calls the backend as an account (`admin` by default, `anon` for nobody),
   * signing it in first and again on a 401; the fixture routes answer in
   * process.
   *
   * @param {string} label
   * @param {ApiRequest} request
   * @returns {Promise<Answer>}
   */
  async api(label, request) {
    const folder = this.step(`api ${label}`);
    if (request.path.startsWith(FIXTURE)) {
      try {
        const body = parseBody(
          JSON.stringify(
            await fixture(
              request.method,
              request.path.slice(FIXTURE.length),
              request.body,
            ),
          ) ?? "null",
        );
        return { status: 200, body, error: null, folder };
      } catch (error) {
        return {
          status: 500,
          body: { message: String(error) },
          error: null,
          folder,
        };
      }
    }
    const url = `${this.state.apiUrl}${request.path}`;
    if (request.token) return { ...(await send({ ...request, url })), folder };
    const as = request.as ?? "admin";
    if (as === "anon") return { ...(await send({ ...request, url })), folder };
    if (!this.state.tokens[as]) await this.signIn(as);
    const first = await send({ ...request, url, token: this.state.tokens[as] });
    if (first.status !== UNAUTHORIZED) return { ...first, folder };
    await this.signIn(as);
    return {
      ...(await send({ ...request, url, token: this.state.tokens[as] })),
      folder,
    };
  }

  /**
   * @param {string} name
   * @param {Account} credentials
   */
  addAccount(name, credentials) {
    this.state.accounts[name] = credentials;
  }

  /**
   * @param {string} prefix
   * @returns {string}
   */
  unique(prefix) {
    return `${prefix} ${randomBytes(3).toString("hex")}`;
  }

  /** @returns {string} A password the DMS accepts */
  password() {
    return newPassword();
  }

  /** @returns {Promise<void>} */
  restartBackend() {
    return restartMarketing(this.state.extraEnv);
  }
}

class CriticalStep extends Error {
  /** @param {string} step */
  constructor(step) {
    super(`critical step ${step} failed`);
    this.step = step;
  }
}

/**
 * The checks that fail the journey: a failing check its `knownFailures` do
 * not list, and a listed check that passes.
 *
 * @param {Step[]} steps
 * @param {Record<string, string>} knownFailures
 * @returns {string[]}
 */
function judge(steps, knownFailures) {
  return steps.flatMap((step) =>
    step.checks.flatMap((check) => {
      const known = Object.hasOwn(knownFailures, check.name);
      if (check.pass === known)
        return [
          `${step.name} › ${check.name}: ${known ? `passes, but knownFailures lists it (${knownFailures[check.name]})` : check.detail}`,
        ];
      return [];
    }),
  );
}

/**
 * Declares one test per journey of a feature, named by its id, each on a
 * fresh marketing state: every marketing table empty, the module's own
 * configuration and the real clock.
 *
 * @param {string} feature
 * @param {Journey[]} journeys
 */
function describeJourneys(feature, journeys) {
  describe(`${feature} journeys`, () => {
    before(function () {
      this.timeout(HOOK_TIMEOUT_MS);
      return onboardOnce();
    });
    beforeEach(async function () {
      this.timeout(HOOK_TIMEOUT_MS);
      Date.now = realNow;
      await expireWarnedCuts();
      await emptyMarketingTables();
      await restartMarketing({});
    });
    after(async function () {
      this.timeout(HOOK_TIMEOUT_MS);
      Date.now = realNow;
      await restartMarketing({});
    });
    for (const journey of journeys) {
      it(journey.id, async function () {
        this.timeout(JOURNEY_TIMEOUT_MS);
        const ctx = new JourneyContext(feature, journey.id);
        const knownFailures = journey.knownFailures ?? {};
        try {
          await journey.run(ctx);
        } catch (error) {
          if (!(error instanceof CriticalStep)) throw error;
        }
        assert.deepEqual(
          judge(ctx.steps, knownFailures),
          [],
          `${journey.title}\nevidence: ${ctx.folder}`,
        );
      });
    }
  });
}

module.exports = { describeJourneys };
