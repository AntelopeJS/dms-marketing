import { randomUUID } from "node:crypto";
import {
  Context,
  Controller,
  Delete,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
  Put,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assertValidation } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  AuthTenantMember,
  AuthTenantOwner,
} from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { z } from "zod";
import { WebsitesModel } from "@/db";
import type { Website } from "@/db/tables/websites.table";
import { invalidateExperimentDefinitions } from "@/services/experiment-definitions";
import { isDashboardWebsite } from "@/services/dashboard-tracking";
import { deleteSnapshots } from "@/services/snapshots";
import {
  listTenantWebsites,
  purgeWebsiteTrackingData,
  requireTenantWebsite,
} from "@/services/tenant-website";
import { invalidateWebsiteCache } from "@/services/website-cache";
import { forgetAcceptedSources } from "@/services/origin-guard";
import {
  findHostConflict,
  isValidHostname,
  normalizeHostname,
} from "@/services/website-hosts";
import {
  connectionStatus,
  websiteDeletionImpact,
  websitesSummary,
} from "@/services/website-report";
import {
  API_BASE_PATH,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  MAX_DOMAIN_LENGTH,
  MAX_EXTRA_DOMAINS,
  MAX_NAME_LENGTH,
} from "@/types/constants";

const INVALID_WEBSITE_MESSAGE = "$page.marketing.errors.invalid_website";
const INVALID_HOSTNAME_MESSAGE = "$page.marketing.errors.invalid_hostname";
const DUPLICATE_HOST_MESSAGE = "$page.marketing.errors.duplicate_host";

/** What the owner types, stored as the bare lowercase hostname. */
const hostnameSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_DOMAIN_LENGTH)
  .transform(normalizeHostname)
  .refine(isValidHostname, { message: INVALID_HOSTNAME_MESSAGE });

const nameSchema = z.string().trim().min(1).max(MAX_NAME_LENGTH);

const extraDomainsSchema = z.array(hostnameSchema).max(MAX_EXTRA_DOMAINS);

const websiteCreateSchema = z.object({
  name: nameSchema,
  domain: hostnameSchema,
  extraDomains: extraDomainsSchema.optional(),
  snapshotsEnabled: z.boolean().optional(),
  snapshotMaskText: z.boolean().optional(),
});

const allowHostSchema = z.object({ hostname: hostnameSchema });

const websiteUpdateSchema = z.object({
  name: nameSchema.optional(),
  domain: hostnameSchema.optional(),
  extraDomains: extraDomainsSchema.optional(),
  trackingEnabled: z.boolean().optional(),
  snapshotsEnabled: z.boolean().optional(),
  snapshotMaskText: z.boolean().optional(),
});

/** Field-tied zod issues, for the forms to show under their field. */
function validationIssues(error: unknown) {
  return error instanceof z.ZodError ? error.issues : INVALID_WEBSITE_MESSAGE;
}

/** Duplicates and the domain itself add nothing to the extra hosts. */
function distinctExtraHosts(domain: string, hosts: string[]): string[] {
  return [...new Set(hosts)].filter((host) => host !== domain);
}

/**
 * 409 when another site of the tenant declares one of these hosts, tied to
 * the field that names it (`{ field, message }`, which the DMS forms show
 * under that field). The dashboard's own site is left out both ways: it
 * shares its host with whatever else answers there (a site in development
 * on localhost), and its tag is the module's, so no traffic is split.
 */
async function assertHostsFree(website: Website): Promise<void> {
  if (isDashboardWebsite(website)) {
    return;
  }
  const websites = await GetModel(WebsitesModel).getByTenant(website.tenantId);
  const conflict = findHostConflict(
    website,
    websites.filter((site) => !isDashboardWebsite(site)),
  );
  if (conflict) {
    throw new HTTPResult(HTTP_CONFLICT, {
      field: conflict.field,
      message: DUPLICATE_HOST_MESSAGE,
      values: [conflict.hostname, conflict.website.name],
    });
  }
}

/** Minimal website CRUD, tenant-scoped through the JWT claim. */
export class WebsitesController extends Controller(
  `${API_BASE_PATH}/websites`,
) {
  @Get("")
  async list(
    @AuthTenantMember() _user: User,
    @Context() context: RequestContext,
  ) {
    return listTenantWebsites(getRequestTenantId(context));
  }

  /** The Websites page: one card per site. */
  @Get("summary")
  async summary(
    @AuthTenantMember() _user: User,
    @Context() context: RequestContext,
  ) {
    const tenantId = getRequestTenantId(context);
    return websitesSummary(tenantId, await listTenantWebsites(tenantId));
  }

  /**
   * What the install guide polls: the newest pageview since `since` (epoch
   * ms; the site's creation by default) and the refused hosts.
   */
  @Get("/:id/connection")
  async connection(
    @AuthTenantMember() _user: User,
    @Parameter("id") id: string,
    @Context() context: RequestContext,
    @Parameter("since", "query") since?: string,
  ) {
    const from = Number(since);
    return connectionStatus(
      await requireTenantWebsite(context, id),
      since && Number.isFinite(from) ? from : undefined,
    );
  }

  /** What deleting the site discards, for the confirmation to list. */
  @Get("/:id/deletion")
  async deletion(
    @AuthTenantOwner() _user: User,
    @Parameter("id") id: string,
    @Context() context: RequestContext,
  ) {
    return websiteDeletionImpact(await requireTenantWebsite(context, id));
  }

  /** The install guide's "Allow this host": a refused host joins extraDomains. */
  @Post("/:id/allow-host")
  async allowHost(
    @AuthTenantOwner() _user: User,
    @Parameter("id") id: string,
    @JSONBody() body: unknown,
    @Context() context: RequestContext,
  ) {
    const website = await requireTenantWebsite(context, id);
    const data = assertValidation(
      body,
      // zod v3 binds `parse` to its schema in the ZodType constructor, so the
      // reference passed here is not actually unbound.
      // oxlint-disable-next-line typescript/unbound-method
      allowHostSchema.parse,
      validationIssues,
    );
    const hosts = new Set(website.extraDomains ?? []);
    if (!hosts.has(data.hostname) && hosts.size >= MAX_EXTRA_DOMAINS) {
      throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_WEBSITE_MESSAGE);
    }
    hosts.add(data.hostname);
    website.extraDomains = distinctExtraHosts(website.domain, [...hosts]);
    await assertHostsFree(website);
    await GetModel(WebsitesModel).update(website);
    invalidateWebsiteCache(id);
    forgetAcceptedSources(website);
    return website;
  }

  @Post("")
  async create(
    @AuthTenantOwner() _user: User,
    @JSONBody() body: unknown,
    @Context() context: RequestContext,
  ) {
    const data = assertValidation(
      body,
      // zod v3 binds `parse` to its schema in the ZodType constructor, so the
      // reference passed here is not actually unbound.
      // oxlint-disable-next-line typescript/unbound-method
      websiteCreateSchema.parse,
      validationIssues,
    );
    const website = {
      _id: randomUUID(),
      tenantId: getRequestTenantId(context),
      name: data.name,
      domain: data.domain,
      extraDomains: distinctExtraHosts(data.domain, data.extraDomains ?? []),
      trackingEnabled: true,
      snapshotsEnabled: data.snapshotsEnabled ?? false,
      snapshotMaskText: data.snapshotMaskText ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Website;
    await assertHostsFree(website);
    await GetModel(WebsitesModel).insert(website);
    return website;
  }

  /**
   * Only keys present in the body are touched. A change to either snapshot
   * option discards the site's captures: off means forgotten, and a mask
   * setting only holds for captures taken under it. `trackingEnabled` false
   * pauses the site: collect refuses its beacons until it is back on.
   */
  @Put("/:id")
  async update(
    @AuthTenantOwner() _user: User,
    @Parameter("id") id: string,
    @JSONBody() body: unknown,
    @Context() context: RequestContext,
  ) {
    const website = await requireTenantWebsite(context, id);
    const data = assertValidation(
      body,
      // zod v3 binds `parse` to its schema in the ZodType constructor, so the
      // reference passed here is not actually unbound.
      // oxlint-disable-next-line typescript/unbound-method
      websiteUpdateSchema.parse,
      validationIssues,
    );
    if (data.name !== undefined) {
      website.name = data.name;
    }
    if (data.domain !== undefined) {
      website.domain = data.domain;
    }
    if (data.extraDomains !== undefined || data.domain !== undefined) {
      website.extraDomains = distinctExtraHosts(
        website.domain,
        data.extraDomains ?? website.extraDomains ?? [],
      );
      await assertHostsFree(website);
    }
    if (data.trackingEnabled !== undefined) {
      website.trackingEnabled = data.trackingEnabled;
    }
    const snapshotOptionsChanged =
      (data.snapshotsEnabled !== undefined &&
        data.snapshotsEnabled !== website.snapshotsEnabled) ||
      (data.snapshotMaskText !== undefined &&
        data.snapshotMaskText !== (website.snapshotMaskText ?? false));
    if (data.snapshotsEnabled !== undefined) {
      website.snapshotsEnabled = data.snapshotsEnabled;
    }
    if (data.snapshotMaskText !== undefined) {
      website.snapshotMaskText = data.snapshotMaskText;
    }
    website.updatedAt = new Date();
    await GetModel(WebsitesModel).update(website);
    if (snapshotOptionsChanged) {
      await deleteSnapshots(website.tenantId, website._id);
    }
    invalidateWebsiteCache(id);
    invalidateExperimentDefinitions(id);
    forgetAcceptedSources(website);
    return website;
  }

  /**
   * Purge before delete: if the purge fails the site stays listed and the
   * call can be retried, whereas the other order strands unreachable rows.
   * Beacons cached on other instances can still land for up to the website
   * cache TTL after this returns.
   */
  @Delete("/:id")
  async remove(
    @AuthTenantOwner() _user: User,
    @Parameter("id") id: string,
    @Context() context: RequestContext,
  ) {
    const website = await requireTenantWebsite(context, id);
    await purgeWebsiteTrackingData(website.tenantId, id);
    await GetModel(WebsitesModel).delete(id);
    invalidateWebsiteCache(id);
    invalidateExperimentDefinitions(id);
    return { deleted: id };
  }
}
