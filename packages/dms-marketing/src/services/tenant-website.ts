import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import {
  FunnelsModel,
  MarketingEventsModel,
  MarketingImportsModel,
  MarketingSessionsModel,
  WebsiteStatisticsModel,
  WebsitesModel,
} from "@/db";
import type { Website } from "@/db/tables/websites.table";
import { HTTP_CONFLICT, HTTP_NOT_FOUND } from "@/types/constants";
import { isDashboardWebsite } from "./dashboard-tracking";
import { resetHeatmap } from "./heatmap";
import { forgetWebsiteSessions } from "./sessionize";
import { deleteSnapshots } from "./snapshots";

const WEBSITE_NOT_FOUND_MESSAGE = "$page.marketing.errors.website_not_found";
const DASHBOARD_WEBSITE_KEPT_MESSAGE =
  "$page.marketing.errors.dashboard_website_kept";

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
 * 409 for the site `dashboardTracking` provisions for its tenant: the
 * module's own tag reports to it, and provisioning would only create it
 * again. Its tracking can still be paused, and its data purged.
 */
export function assertWebsiteDeletable(website: Website): void {
  if (isDashboardWebsite(website)) {
    throw new HTTPResult(HTTP_CONFLICT, DASHBOARD_WEBSITE_KEPT_MESSAGE);
  }
}

/** What a purge deletes: everything collected, or the heatmaps alone. */
export const WEBSITE_PURGE_SCOPES = ["all", "heatmaps"] as const;
export type WebsitePurgeScope = (typeof WEBSITE_PURGE_SCOPES)[number];

/** What a purge deleted, row counts per kind (0 for what its scope keeps). */
export interface WebsitePurge {
  /** Raw events; the clicks and scrolls alone for the heatmaps. */
  events: number;
  sessions: number;
  days: number;
  snapshots: number;
  imports: number;
}

/**
 * The heatmaps scope deletes what the heatmaps are drawn from: the click
 * and scroll events of every page and the page snapshots under them. The
 * click counts shown anywhere are read off those events, so they all drop
 * to zero; the traffic (pageviews, sessions, daily statistics) stays.
 *
 * The all scope deletes everything collected for the site — raw events
 * (pageviews, clicks and scrolls, A/B exposures and goals), sessions, daily
 * statistics, page snapshots and imported history.
 *
 * Either way the site, its settings and its funnels stay: funnel and A/B
 * results are read off the events, so they start again from zero. Running
 * a purge again deletes nothing more.
 */
export async function purgeWebsiteCollectedData(
  tenantId: string,
  websiteId: string,
  scope: WebsitePurgeScope = "all",
): Promise<WebsitePurge> {
  if (scope === "heatmaps") {
    const heatmaps = await resetHeatmap(tenantId, websiteId);
    return { ...heatmaps, sessions: 0, days: 0, imports: 0 };
  }
  const events = await GetModel(MarketingEventsModel, tenantId).deleteByWebsite(
    websiteId,
  );
  const sessions = await GetModel(
    MarketingSessionsModel,
    tenantId,
  ).deleteByWebsite(websiteId);
  forgetWebsiteSessions(websiteId);
  const days = await GetModel(WebsiteStatisticsModel, tenantId).deleteByWebsite(
    websiteId,
  );
  const snapshots = await deleteSnapshots(tenantId, websiteId);
  const imports = await GetModel(
    MarketingImportsModel,
    tenantId,
  ).deleteByWebsite(websiteId);
  return { events, sessions, days, snapshots, imports };
}

/**
 * Tracking data dies with its site: the retention prune enumerates tenants
 * through the websites table, so rows left behind by a deleted site — of a
 * tenant whose LAST site it was — would outlive every retention pass. Its
 * funnels (and their A/B tests) go too: they are read through their site,
 * so nothing could list, compute or delete them afterwards.
 */
export async function purgeWebsiteTrackingData(
  tenantId: string,
  websiteId: string,
): Promise<void> {
  await purgeWebsiteCollectedData(tenantId, websiteId);
  await GetModel(FunnelsModel, tenantId).deleteByWebsite(websiteId);
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
  return [...websites].sort(
    (a, b) => (activity.get(b._id) ?? 0) - (activity.get(a._id) ?? 0),
  );
}
