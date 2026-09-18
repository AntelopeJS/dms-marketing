import { randomUUID } from "node:crypto";
import {
  Context,
  Controller,
  Delete,
  Get,
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
import { deleteSnapshots } from "@/services/snapshots";
import {
  listTenantWebsites,
  purgeWebsiteTrackingData,
  requireTenantWebsite,
} from "@/services/tenant-website";
import { invalidateWebsiteCache } from "@/services/website-cache";
import {
  API_BASE_PATH,
  MAX_DOMAIN_LENGTH,
  MAX_EXTRA_DOMAINS,
  MAX_NAME_LENGTH,
} from "@/types/constants";

const INVALID_WEBSITE_MESSAGE = "$page.marketing.errors.invalid_website";

const extraDomainsSchema = z
  .array(z.string().min(1).max(MAX_DOMAIN_LENGTH))
  .max(MAX_EXTRA_DOMAINS);

const websiteCreateSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH),
  domain: z.string().min(1).max(MAX_DOMAIN_LENGTH),
  extraDomains: extraDomainsSchema.optional(),
  snapshotsEnabled: z.boolean().optional(),
  snapshotMaskText: z.boolean().optional(),
});

const websiteUpdateSchema = z.object({
  name: z.string().min(1).max(MAX_NAME_LENGTH).optional(),
  domain: z.string().min(1).max(MAX_DOMAIN_LENGTH).optional(),
  extraDomains: extraDomainsSchema.optional(),
  snapshotsEnabled: z.boolean().optional(),
  snapshotMaskText: z.boolean().optional(),
});

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
      () => INVALID_WEBSITE_MESSAGE,
    );
    const website = {
      _id: randomUUID(),
      tenantId: getRequestTenantId(context),
      name: data.name,
      domain: data.domain,
      extraDomains: data.extraDomains ?? [],
      trackingEnabled: true,
      snapshotsEnabled: data.snapshotsEnabled ?? false,
      snapshotMaskText: data.snapshotMaskText ?? false,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as Website;
    await GetModel(WebsitesModel).insert(website);
    return website;
  }

  /**
   * Only keys present in the body are touched. A change to either snapshot
   * option discards the site's captures: off means forgotten, and a mask
   * setting only holds for captures taken under it.
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
      () => INVALID_WEBSITE_MESSAGE,
    );
    if (data.name !== undefined) {
      website.name = data.name;
    }
    if (data.domain !== undefined) {
      website.domain = data.domain;
    }
    if (data.extraDomains !== undefined) {
      website.extraDomains = data.extraDomains;
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
    await GetModel(WebsitesModel).update(website);
    if (snapshotOptionsChanged) {
      await deleteSnapshots(website.tenantId, website._id);
    }
    invalidateWebsiteCache(id);
    invalidateExperimentDefinitions(id);
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
