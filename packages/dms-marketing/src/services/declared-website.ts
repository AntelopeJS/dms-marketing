import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  MarketingDeclarationResult,
  MarketingWebsiteDeclaration,
} from "@antelopejs/interface-dms-marketing";
import { z } from "zod";
import { WebsitesModel } from "@/db";
import type { Website } from "@/db/tables/websites.table";
import {
  contentHash,
  declaredTenant,
  describeIssue,
  isUntouchedSinceDeclared,
  MarketingDeclarationError,
  requireDeclaredId,
} from "./declarations";
import { invalidateExperimentDefinitions } from "./experiment-definitions";
import { forgetAcceptedSources } from "./origin-guard";
import { deleteSnapshots } from "./snapshots";
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

/** What a declaration sets, normalized: also what its hash covers. */
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

/** The same fields read off a stored row, in the same order. */
function storedContent(website: Website): WebsiteContent {
  return {
    name: website.name,
    domain: website.domain,
    extraDomains: website.extraDomains ?? [],
    trackingEnabled: website.trackingEnabled,
    snapshotsEnabled: website.snapshotsEnabled ?? false,
    snapshotMaskText: website.snapshotMaskText ?? false,
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
 * Brings an existing row to the declaration when it is still the one last
 * declared; leaves it to its owner otherwise. A change to either snapshot
 * option discards the site's captures, as the dashboard's edit does.
 */
async function refreshWebsite(
  existing: Website,
  tenantId: string,
  content: WebsiteContent,
): Promise<MarketingDeclarationResult> {
  const id = existing._id;
  if (existing.tenantId !== tenantId) {
    throw new MarketingDeclarationError(
      OPERATION,
      id,
      "this id already names a website of another tenant",
    );
  }
  if (
    !isUntouchedSinceDeclared(existing.declaredHash, storedContent(existing))
  ) {
    // Once divergence is observed, restoring the old values must not give
    // ownership back to code. Change only metadata, never the owner's fields.
    if (existing.declaredHash) {
      await GetModel(WebsitesModel).update(id, { declaredHash: "" });
    }
    return { id, status: "kept" };
  }
  const declaredHash = contentHash(content);
  if (declaredHash === existing.declaredHash) {
    return { id, status: "unchanged" };
  }
  const before = storedContent(existing);
  Object.assign(existing, content, { declaredHash, updatedAt: new Date() });
  await assertHostsFree(existing);
  await GetModel(WebsitesModel).update(existing);
  if (
    before.snapshotsEnabled !== content.snapshotsEnabled ||
    before.snapshotMaskText !== content.snapshotMaskText
  ) {
    await deleteSnapshots(tenantId, id);
  }
  invalidateWebsiteCache(id);
  invalidateExperimentDefinitions(id);
  forgetAcceptedSources(existing);
  return { id, status: "updated" };
}

/**
 * EnsureWebsite: the declared id is the website id itself, so the tag a
 * project ships can name it before the site exists.
 */
export async function ensureWebsite(
  declaration: MarketingWebsiteDeclaration,
): Promise<MarketingDeclarationResult> {
  const id = requireDeclaredId(OPERATION, declaration?.id);
  const tenantId = declaredTenant(declaration.tenantId);
  const content = declaredContent(id, declaration);
  const model = GetModel(WebsitesModel);
  const existing = await model.get(id);
  if (existing) {
    return refreshWebsite(existing, tenantId, content);
  }
  const now = new Date();
  const website = {
    _id: id,
    tenantId,
    ...content,
    declaredHash: contentHash(content),
    createdAt: now,
    updatedAt: now,
  } as Website;
  await assertHostsFree(website);
  try {
    await model.insert(website);
  } catch (err) {
    // Another instance booting the same project inserted it first.
    const raced = await model.get(id);
    if (!raced) {
      throw err;
    }
    return refreshWebsite(raced, tenantId, content);
  }
  invalidateWebsiteCache(id);
  return { id, status: "created" };
}
