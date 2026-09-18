import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import {
  MarketingEventsModel,
  MarketingSessionsModel,
  WebsiteStatisticsModel,
  WebsitesModel,
} from "@/db";
import type { Website } from "@/db/tables/websites.table";
import { HTTP_NOT_FOUND } from "@/types/constants";
import { deleteSnapshots } from "./snapshots";

const WEBSITE_NOT_FOUND_MESSAGE = "$page.marketing.errors.website_not_found";

/**
 * Website of the caller's tenant, or 404 — the ownership gate every
 * authenticated marketing read goes through. Websites are the one global
 * table, so ownership is a column check here; a cross-tenant id answers
 * exactly like a missing one, so ids cannot be probed.
 */
export async function requireTenantWebsite(
  context: RequestContext,
  id: string | undefined,
): Promise<Website> {
  const website = id ? await GetModel(WebsitesModel).get(id) : undefined;
  if (!website || website.tenantId !== getRequestTenantId(context)) {
    throw new HTTPResult(HTTP_NOT_FOUND, WEBSITE_NOT_FOUND_MESSAGE);
  }
  return website;
}

/**
 * Tracking data dies with its site: the retention prune enumerates tenants
 * through the websites table, so rows left behind by a deleted site — of a
 * tenant whose LAST site it was — would outlive every retention pass.
 * Definitions (funnels, experiments) are owner-authored and not
 * retention-bound; they stay.
 */
export async function purgeWebsiteTrackingData(
  tenantId: string,
  websiteId: string,
): Promise<void> {
  await GetModel(MarketingEventsModel, tenantId).deleteByWebsite(websiteId);
  await GetModel(MarketingSessionsModel, tenantId).deleteByWebsite(websiteId);
  await GetModel(WebsiteStatisticsModel, tenantId).deleteByWebsite(websiteId);
  await deleteSnapshots(tenantId, websiteId);
}

/**
 * Most recently active first: dashboards land on the first entry, and a
 * never-visited site is the worst possible default.
 */
export async function listTenantWebsites(tenantId: string): Promise<Website[]> {
  const websites = await GetModel(WebsitesModel).getByTenant(tenantId);
  if (websites.length < 2) {
    return websites;
  }
  const activity = await GetModel(
    MarketingSessionsModel,
    tenantId,
  ).getLastActivityByWebsites(websites.map((site) => site._id));
  // Stable sort: sites without activity keep the model's createdAt ordering.
  return [...websites].sort(
    (a, b) => (activity.get(b._id) ?? 0) - (activity.get(a._id) ?? 0),
  );
}
