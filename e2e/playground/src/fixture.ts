import { randomUUID } from "node:crypto";
import { Controller, Get, JSONBody, Post } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { DEFAULT_TENANT_ID } from "@antelopejs/interface-dms/constants";
import { RoleModel, UserInviteModel } from "@antelopejs/interface-dms/db";
import {
  EnsureFunnel,
  EnsurePageSnapshot,
  EnsureWebsite,
  GetClickHeatmap,
  ImportAnalytics,
  type MarketingAnalyticsImport,
  type MarketingFunnelDeclaration,
  type MarketingPageSnapshotDeclaration,
  type MarketingWebsiteDeclaration,
} from "@antelopejs/interface-dms-marketing";
import { z } from "zod";

const INVITE_LIFETIME_MS = 3_600_000;

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

/** What a trusted backend call answered: its result, or the message it rejected with. */
type Outcome<T> = { ok: true; result: T } | { ok: false; error: string };

async function outcome<T>(call: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, result: await call() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** The ids of the permissions a role holds, with every id its grants sit under. */
function withAncestors(permissions: string[]): string[] {
  return [
    ...new Set(
      permissions.flatMap((id) => {
        const segments = id.split(".");
        return segments.map((_, index) => segments.slice(0, index + 1).join("."));
      }),
    ),
  ];
}

/**
 * Trusted backend calls a journey cannot make over HTTP: members with a role,
 * and the interface's four content functions and its heatmap read. Only the
 * verification playground serves them. The body of each call is the
 * declaration exactly as the interface takes it, so a journey sends whatever a
 * careless caller would.
 */
export class VerifyFixtureController extends Controller("/verify-marketing") {
  @Post("/member")
  async member(@JSONBody() body: unknown) {
    const { name, permissions, asTenantOwner, language } = memberSchema.parse(body);
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

  @Post("/website")
  website(@JSONBody() body: MarketingWebsiteDeclaration) {
    return outcome(() => EnsureWebsite(body));
  }

  @Post("/funnel")
  funnel(@JSONBody() body: MarketingFunnelDeclaration) {
    return outcome(() => EnsureFunnel(body));
  }

  @Post("/snapshot")
  snapshot(@JSONBody() body: MarketingPageSnapshotDeclaration) {
    return outcome(() => EnsurePageSnapshot(body));
  }

  @Post("/import")
  import(@JSONBody() body: MarketingAnalyticsImport) {
    return outcome(() => ImportAnalytics(body));
  }

  @Post("/heatmap")
  heatmap(@JSONBody() body: unknown) {
    return outcome(() => GetClickHeatmap(heatmapSchema.parse(body)));
  }

  @Get("/tenant")
  tenant() {
    return { tenantId: DEFAULT_TENANT_ID };
  }
}
