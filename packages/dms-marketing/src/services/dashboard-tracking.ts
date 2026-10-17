import { createHash } from "node:crypto";
import type { Website } from "@/db/tables/websites.table";
import {
  DASHBOARD_AUTH_PATHS,
  FRONTEND_CONFIG_KEY,
  MAX_EXTRA_DOMAINS,
} from "@/types/constants";
import type { DashboardTrackingConfig } from "@/config";
import { websiteAcceptsHostname } from "./origin-guard";

/** Keeps the tenant id out of the tag: the id is a digest of it. */
const DASHBOARD_ID_NAMESPACE = "dms-marketing:dashboard:";
const DASHBOARD_ID_PREFIX = "dashboard-";
const DASHBOARD_ID_HEX_CHARS = 32;

/** What provisioning needs of the websites model. */
export interface DashboardWebsiteStore {
  get(id: string): PromiseLike<Website | undefined>;
  insert(website: Website): Promise<unknown>;
  update(website: Website): Promise<unknown>;
}

/**
 * One website per tenant, its id derived from the tenant: every instance and
 * every tab computes the same one, so provisioning needs no lookup table and
 * two first visits at once cannot create two sites.
 */
export function dashboardWebsiteId(tenantId: string): string {
  const digest = createHash("sha256")
    .update(DASHBOARD_ID_NAMESPACE + tenantId)
    .digest("hex");
  return DASHBOARD_ID_PREFIX + digest.slice(0, DASHBOARD_ID_HEX_CHARS);
}

/** The website `provisionDashboardWebsite` created for its tenant. */
export function isDashboardWebsite(
  website: Pick<Website, "_id" | "tenantId">,
): boolean {
  return website._id === dashboardWebsiteId(website.tenantId);
}

/** The patterns the tag leaves uncounted: the sign-in pages, then the
 * configured ones. */
export function dashboardExcludedPaths(
  config: DashboardTrackingConfig,
): string[] {
  return [...new Set([...DASHBOARD_AUTH_PATHS, ...config.excludePaths])];
}

/**
 * What `AddFrontendModule` gets for the dashboard's tag: nothing while it is
 * off, so a module left at the default registers exactly as before; the
 * frontend registers its plugin only when the options are there. Read by the
 * frontend at boot: a change takes a frontend restart.
 */
export function dashboardFrontendOptions(config: DashboardTrackingConfig) {
  if (!config.enabled) {
    return {};
  }
  return {
    configKey: FRONTEND_CONFIG_KEY,
    options: {
      dashboardTracking: { excludePaths: dashboardExcludedPaths(config) },
    },
  };
}

/**
 * A host the site does not accept yet joins its extra domains while there is
 * room: the dashboard answers on whatever host its deployment gives it
 * (localhost, a staging name, the real one), and no owner registered it.
 * Past the cap the beacons are refused and logged like any other site's.
 */
async function acceptHostname(
  store: DashboardWebsiteStore,
  website: Website,
  hostname: string,
): Promise<boolean> {
  const extraDomains = website.extraDomains ?? [];
  if (
    websiteAcceptsHostname(website, hostname) ||
    extraDomains.length >= MAX_EXTRA_DOMAINS
  ) {
    return false;
  }
  website.extraDomains = [...extraDomains, hostname];
  website.updatedAt = new Date();
  await store.update(website);
  return true;
}

/**
 * The tenant's dashboard website, created on the first call, and the host
 * the dashboard was opened from accepted. Idempotent: an existing site keeps
 * its name and settings — an owner may rename or pause it like any other —
 * and a site an owner deleted comes back on the next dashboard visit.
 *
 * Snapshots stay off: a capture of an admin page would store the records it
 * shows.
 *
 * Returns whether the record changed, for the caller to drop cached copies.
 */
export async function provisionDashboardWebsite(
  store: DashboardWebsiteStore,
  tenantId: string,
  hostname: string,
  config: DashboardTrackingConfig,
): Promise<{ website: Website; changed: boolean }> {
  const id = dashboardWebsiteId(tenantId);
  const existing = await store.get(id);
  if (existing) {
    return {
      website: existing,
      changed: await acceptHostname(store, existing, hostname),
    };
  }
  const now = new Date();
  const website = {
    _id: id,
    tenantId,
    name: config.websiteName,
    domain: hostname,
    extraDomains: [],
    trackingEnabled: true,
    snapshotsEnabled: false,
    snapshotMaskText: true,
    createdAt: now,
    updatedAt: now,
  } as Website;
  try {
    await store.insert(website);
  } catch (err) {
    // Another tab or instance inserted the same id first: theirs stands.
    const raced = await store.get(id);
    if (!raced) {
      throw err;
    }
    return {
      website: raced,
      changed: await acceptHostname(store, raced, hostname),
    };
  }
  return { website, changed: true };
}
