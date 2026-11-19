const { randomUUID } = require("node:crypto");
const { z } = require("zod");
const { GetModel } = require("@antelopejs/interface-database-decorators");
const { DEFAULT_TENANT_ID } = require("@antelopejs/interface-dms/constants");
const { RoleModel, UserInviteModel } = require("@antelopejs/interface-dms/db");
const { GetRegisteredHooks, Hook } = require("@antelopejs/interface-dms/hooks");
const marketing = require("@antelopejs/interface-dms-marketing");

const INVITE_LIFETIME_MS = 3_600_000;
/** The clock before any journey moved it. */
const realNow = Date.now.bind(Date);

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

module.exports = { fixture, realNow };
