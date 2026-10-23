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
import { PublishMessage } from "@antelopejs/interface-dms/realtime";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { z } from "zod";
import { WebsitesModel } from "@/db";
import type { Website } from "@/db/tables/websites.table";
import { setSnapshotsByOwner } from "@/services/dashboard-tracking";
import { invalidateExperimentDefinitions } from "@/services/experiment-definitions";
import { deleteSnapshots } from "@/services/snapshots";
import {
  assertWebsiteDeletable,
  listTenantWebsites,
  purgeWebsiteCollectedData,
  purgeWebsiteTrackingData,
  requireTenantWebsite,
  WEBSITE_PURGE_SCOPES,
} from "@/services/tenant-website";
import { invalidateWebsiteCache } from "@/services/website-cache";
import { forgetAcceptedSources } from "@/services/origin-guard";
import {
  distinctExtraHosts,
  extraDomainsSchema,
  hostnameSchema,
  nameSchema,
  tenantHostConflict,
} from "@/services/website-rules";
import {
  connectionStatus,
  websiteDeletionImpact,
} from "@/services/website-report";
import {
  API_BASE_PATH,
  HTTP_BAD_REQUEST,
  HTTP_CONFLICT,
  MAX_EXTRA_DOMAINS,
  WEBSITES_REALTIME_TOPIC,
} from "@/types/constants";

const INVALID_WEBSITE_MESSAGE = "$page.marketing.errors.invalid_website";
const DUPLICATE_HOST_MESSAGE = "$page.marketing.errors.duplicate_host";

const websiteCreateSchema = z.object({
  name: nameSchema,
  domain: hostnameSchema,
  extraDomains: extraDomainsSchema.optional(),
  snapshotsEnabled: z.boolean().optional(),
  snapshotMaskText: z.boolean().optional(),
});

const allowHostSchema = z.object({ hostname: hostnameSchema });

const purgeSchema = z.object({ scope: z.enum(WEBSITE_PURGE_SCOPES) });

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

/**
 * 409 when another site of the tenant declares one of these hosts, tied to
 * the field that names it (`{ field, message }`, which the DMS forms show
 * under that field).
 */
async function assertHostsFree(website: Website): Promise<void> {
  const conflict = await tenantHostConflict(website);
  if (conflict) {
    throw new HTTPResult(HTTP_CONFLICT, {
      field: conflict.field,
      message: DUPLICATE_HOST_MESSAGE,
      values: [conflict.hostname, conflict.website.name],
    });
  }
}

/**
 * Tells the Websites pages a site changed: they read their cards again. Only
 * the id travels, and the reads stay tenant-scoped.
 */
function publishWebsiteChange(type: string, id: string): void {
  void PublishMessage(WEBSITES_REALTIME_TOPIC, type, {
    payload: { ids: [id] },
  }).catch(() => undefined);
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

  /** What deleting the site, or purging its data, discards: for the
   * confirmations to list. */
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
    publishWebsiteChange("updated", id);
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
    publishWebsiteChange("created", website._id);
    return website;
  }

  /**
   * Only keys present in the body are touched. A change to either snapshot
   * option discards the site's captures: off means forgotten, and a mask
   * setting only holds for captures taken under it. `trackingEnabled` false
   * pauses the site: collect refuses its beacons until it is back on.
   * Changing `snapshotsEnabled` makes it the owner's: a configured value
   * (`dashboardTracking.snapshots`) never overrides it again.
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
      setSnapshotsByOwner(website, data.snapshotsEnabled);
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
    publishWebsiteChange("updated", id);
    return website;
  }

  /**
   * Deletes what the site collected — `{ scope: "all" }` — or its heatmaps
   * alone — `{ scope: "heatmaps" }` — and keeps the site, its settings and
   * its funnels, whose results start again from zero. The scope is never
   * implied. Idempotent: a second call deletes nothing and answers zeros.
   */
  @Post("/:id/purge")
  async purge(
    @AuthTenantOwner() _user: User,
    @Parameter("id") id: string,
    @JSONBody() body: unknown,
    @Context() context: RequestContext,
  ) {
    const website = await requireTenantWebsite(context, id);
    const { scope } = assertValidation(
      body,
      // zod v3 binds `parse` to its schema in the ZodType constructor, so the
      // reference passed here is not actually unbound.
      // oxlint-disable-next-line typescript/unbound-method
      purgeSchema.parse,
      validationIssues,
    );
    const deleted = await purgeWebsiteCollectedData(
      website.tenantId,
      id,
      scope,
    );
    publishWebsiteChange("updated", id);
    return { purged: id, scope, deleted };
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
    // The dashboard's own site is kept (409): purge its data instead.
    assertWebsiteDeletable(website);
    await purgeWebsiteTrackingData(website.tenantId, id);
    await GetModel(WebsitesModel).delete(id);
    invalidateWebsiteCache(id);
    invalidateExperimentDefinitions(id);
    publishWebsiteChange("deleted", id);
    return { deleted: id };
  }
}
