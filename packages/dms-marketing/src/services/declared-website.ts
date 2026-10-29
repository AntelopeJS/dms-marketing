import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  MarketingDeclarationResult,
  MarketingWebsiteDeclaration,
} from "@antelopejs/interface-dms-marketing";
import { z } from "zod";
import { WebsitesModel } from "@/db";
import type { Website } from "@/db/tables/websites.table";
import {
  declaredTenant,
  describeIssue,
  MarketingDeclarationError,
  requireDeclaredId,
} from "./declarations";
import { invalidateWebsiteCache } from "./website-cache";
import {
  distinctExtraHosts,
  extraDomainsSchema,
  hostnameSchema,
  nameSchema,
  tenantHostConflict,
} from "./website-rules";

const OPERATION = "EnsureWebsite";

/** The fields of the dashboard's create and edit forms, same rules. */
const declarationSchema = z.object({
  name: nameSchema,
  domain: hostnameSchema,
  extraDomains: extraDomainsSchema.optional(),
  trackingEnabled: z.boolean().optional(),
  snapshotsEnabled: z.boolean().optional(),
  snapshotMaskText: z.boolean().optional(),
});

/** What a declaration sets, normalized. */
interface WebsiteContent {
  name: string;
  domain: string;
  extraDomains: string[];
  trackingEnabled: boolean;
  snapshotsEnabled: boolean;
  snapshotMaskText: boolean;
}

function declaredContent(
  id: string,
  declaration: MarketingWebsiteDeclaration,
): WebsiteContent {
  const parsed = declarationSchema.safeParse(declaration);
  if (!parsed.success) {
    throw new MarketingDeclarationError(
      OPERATION,
      id,
      describeIssue(parsed.error),
    );
  }
  const data = parsed.data;
  return {
    name: data.name,
    domain: data.domain,
    extraDomains: distinctExtraHosts(data.domain, data.extraDomains ?? []),
    trackingEnabled: data.trackingEnabled ?? true,
    snapshotsEnabled: data.snapshotsEnabled ?? false,
    snapshotMaskText: data.snapshotMaskText ?? false,
  };
}

async function assertHostsFree(website: Website): Promise<void> {
  const conflict = await tenantHostConflict(website);
  if (conflict) {
    throw new MarketingDeclarationError(
      OPERATION,
      website._id,
      `the host "${conflict.hostname}" is already declared by the website "${conflict.website.name}"`,
    );
  }
}

/**
 * A website the id already names: left as it is, since it belongs to its
 * owner from its creation on. An id of another tenant is refused.
 */
function keptWebsite(
  existing: Website,
  tenantId: string,
): MarketingDeclarationResult {
  if (existing.tenantId !== tenantId) {
    throw new MarketingDeclarationError(
      OPERATION,
      existing._id,
      "this id already names a website of another tenant",
    );
  }
  return { id: existing._id, status: "kept" };
}

/**
 * EnsureWebsite: the declared id is the website id itself, so the tag a
 * project ships can name it before the site exists. Written once, when the
 * tenant is provisioned: an id that already exists is `kept`.
 */
export async function ensureWebsite(
  declaration: MarketingWebsiteDeclaration,
): Promise<MarketingDeclarationResult> {
  const id = requireDeclaredId(OPERATION, declaration?.id);
  const tenantId = declaredTenant(OPERATION, id, declaration.tenantId);
  const content = declaredContent(id, declaration);
  const model = GetModel(WebsitesModel);
  const existing = await model.get(id);
  if (existing) {
    return keptWebsite(existing, tenantId);
  }
  const now = new Date();
  const website: Website = {
    _id: id,
    tenantId,
    ...content,
    createdAt: now,
    updatedAt: now,
  };
  await assertHostsFree(website);
  try {
    await model.insert(website);
  } catch (err) {
    const raced = await model.get(id);
    if (!raced) {
      throw err;
    }
    return keptWebsite(raced, tenantId);
  }
  invalidateWebsiteCache(id);
  return { id, status: "created" };
}
