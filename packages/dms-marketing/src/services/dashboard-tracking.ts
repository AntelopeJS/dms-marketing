import { createHash } from "node:crypto";
import { MODULE_URL_PREFIX } from "@antelopejs/interface-dms/page";
import type { WebsitesModel } from "@/db/models/websites.model";
import type { Website } from "@/db/tables/websites.table";
import { MAX_EXTRA_DOMAINS } from "@/types/constants";
import type { DashboardTrackingConfig } from "@/config";
import { websiteAcceptsHostname } from "./origin-guard";

/** Keeps the tenant id out of the tag: the id is a digest of it. */
const DASHBOARD_ID_NAMESPACE = "dms-marketing:dashboard:";
const DASHBOARD_ID_PREFIX = "dashboard-";
const DASHBOARD_ID_HEX_CHARS = 32;

/** What provisioning needs of the websites model. */
export interface DashboardWebsiteStore {
  get(id: string): PromiseLike<Website | undefined>;
  insert(website: Website): ReturnType<WebsitesModel["insert"]>;
  update(website: Website): ReturnType<WebsitesModel["update"]>;
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

const MODULE_AREA_PATH = MODULE_URL_PREFIX.toLowerCase();

/**
 * `path` (as stored: pathname only) lies in the DMS module area, which the
 * dashboard's website never counts (`DASHBOARD_MODULE_AREA_PATHS`). Case
 * blind: the dashboard's router is, so `/Modules/x` shows the same page.
 */
export function isModuleAreaPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower === MODULE_AREA_PATH || lower.startsWith(`${MODULE_AREA_PATH}/`);
}

/**
 * The dashboard's website never collects `path`: the tag leaves the module
 * area out and collection refuses it. Any other website keeps every path —
 * a site of its own may well have a `/modules` page.
 */
export function hidesDashboardPath(
  website: Pick<Website, "_id" | "tenantId">,
  path: string,
): boolean {
  return isModuleAreaPath(path) && isDashboardWebsite(website);
}

/**
 * A host the site does not accept yet joins its extra domains while there is
 * room: the dashboard answers on whatever host its deployment gives it
 * (localhost, a staging name, the real one), and no owner registered it.
 * Past the cap the beacons are refused and logged like any other site's.
 */
function acceptHostname(website: Website, hostname: string): boolean {
  const extraDomains = website.extraDomains ?? [];
  if (
    websiteAcceptsHostname(website, hostname) ||
    extraDomains.length >= MAX_EXTRA_DOMAINS
  ) {
    return false;
  }
  website.extraDomains = [...extraDomains, hostname];
  return true;
}

/**
 * Brings the snapshot switch to `dashboardTracking.snapshots` while it is
 * the configuration's to set. Once a person changed it (`owner`), it is
 * left alone for good.
 */
function applyConfiguredSnapshots(
  website: Website,
  config: DashboardTrackingConfig,
): boolean {
  const current = website.snapshotsEnabled ?? false;
  if (website.snapshotsSetBy === "owner" || current === config.snapshots) {
    return false;
  }
  website.snapshotsEnabled = config.snapshots;
  website.snapshotsSetBy = "config";
  return true;
}

/**
 * A person sets the snapshot switch (the Websites page, the API): the value
 * becomes the owner's, which configuration never overrides again. False
 * when it already had that value — re-saving a form claims nothing.
 */
export function setSnapshotsByOwner(
  website: Website,
  enabled: boolean,
): boolean {
  if ((website.snapshotsEnabled ?? false) === enabled) {
    return false;
  }
  website.snapshotsEnabled = enabled;
  website.snapshotsSetBy = "owner";
  return true;
}

async function refreshWebsite(
  store: DashboardWebsiteStore,
  website: Website,
  hostname: string,
  config: DashboardTrackingConfig,
): Promise<DashboardProvisioning> {
  const snapshotsChanged = applyConfiguredSnapshots(website, config);
  const hostAdded = acceptHostname(website, hostname);
  if (!snapshotsChanged && !hostAdded) {
    return { website, changed: false, snapshotsChanged };
  }
  website.updatedAt = new Date();
  await store.update(website);
  return { website, changed: true, snapshotsChanged };
}

export interface DashboardProvisioning {
  website: Website;
  /** The record changed: cached copies are stale. */
  changed: boolean;
  /** `snapshotsEnabled` changed on an existing record: its captures go. */
  snapshotsChanged: boolean;
}

/**
 * The tenant's dashboard website, created on the first call, and the host
 * the dashboard was opened from accepted. Idempotent: an existing site keeps
 * its name and settings — an owner may rename or pause it like any other —
 * and a site an owner deleted comes back on the next dashboard visit.
 *
 * Snapshots follow `dashboardTracking.snapshots` (off by default: a capture
 * of an admin page stores the records it shows, so text is masked) until an
 * owner changes them; see `applyConfiguredSnapshots`.
 */
export async function provisionDashboardWebsite(
  store: DashboardWebsiteStore,
  tenantId: string,
  hostname: string,
  config: DashboardTrackingConfig,
): Promise<DashboardProvisioning> {
  const id = dashboardWebsiteId(tenantId);
  const existing = await store.get(id);
  if (existing) {
    return refreshWebsite(store, existing, hostname, config);
  }
  const now = new Date();
  const website: Website = {
    _id: id,
    tenantId,
    name: config.websiteName,
    domain: hostname,
    extraDomains: [],
    trackingEnabled: true,
    snapshotsEnabled: config.snapshots,
    snapshotsSetBy: "config",
    snapshotMaskText: true,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await store.insert(website);
  } catch (err) {
    const raced = await store.get(id);
    if (!raced) {
      throw err;
    }
    return refreshWebsite(store, raced, hostname, config);
  }
  return { website, changed: true, snapshotsChanged: false };
}
