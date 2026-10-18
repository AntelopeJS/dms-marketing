import { HTTPResult } from "@antelopejs/interface-api";
import type { Tenant } from "@antelopejs/interface-dms/db";
import type { Website } from "@/db/tables/websites.table";
import { HTTP_NOT_FOUND } from "@/types/constants";
import { dashboardWebsiteId, isDashboardWebsite } from "./dashboard-tracking";

const WORKSPACE_NOT_FOUND_MESSAGE =
  "$page.marketing.errors.workspace_not_found";

/** The `workspace` value of the combined view: every workspace's dashboard. */
export const ALL_WORKSPACES = "all";

/** What the workspace scope reads of the DMS core and the websites table. */
export interface WorkspaceScopeStores {
  tenants: {
    get(id: string): PromiseLike<Tenant | undefined>;
    getAll(): PromiseLike<Tenant[]>;
  };
  websites: { getMany(ids: string[]): Promise<Website[]> };
}

/** Who asks: the signed-in user's platform flag and their workspace. */
export interface WorkspaceViewer {
  owner?: boolean;
  tenantId: string;
}

/** One entry of the workspace selector. */
export interface WorkspaceOption {
  id: string;
  name: string;
  /** The viewer's own workspace. */
  current: boolean;
}

/** One site a scoped read covers, read in its own tenant. */
export interface ScopedSite {
  tenantId: string;
  website: Website;
}

export interface WorkspaceScope {
  sites: ScopedSite[];
  /**
   * The read reaches past the viewer's workspace (another one, or all of
   * them): backdrops go out text-masked and nothing is written through it.
   */
  foreign: boolean;
}

function notFound(): HTTPResult {
  return new HTTPResult(HTTP_NOT_FOUND, WORKSPACE_NOT_FOUND_MESSAGE);
}

/**
 * Whether the viewer may look past their workspace from `website`: a
 * platform owner, on their own workspace's dashboard site. Customer websites
 * stay per workspace.
 */
function canWidenScope(viewer: WorkspaceViewer, website: Website): boolean {
  return (
    viewer.owner === true &&
    website.tenantId === viewer.tenantId &&
    isDashboardWebsite(website)
  );
}

/**
 * The dashboard site of each tenant that has one, with the tenant: a
 * workspace nobody opened the dashboard of has no site, hence nothing to
 * show, and is left out.
 */
async function dashboardSites(
  stores: WorkspaceScopeStores,
  tenants: Tenant[],
): Promise<Array<{ tenant: Tenant; website: Website }>> {
  const byId = new Map(
    (
      await stores.websites.getMany(
        tenants.map((tenant) => dashboardWebsiteId(tenant._id)),
      )
    ).map((website) => [website._id, website]),
  );
  return tenants.flatMap((tenant) => {
    const website = byId.get(dashboardWebsiteId(tenant._id));
    return website?.tenantId === tenant._id ? [{ tenant, website }] : [];
  });
}

/**
 * The workspaces a platform owner can read the dashboard's heatmaps of, from
 * the DMS core's tenant registry: their own first, then by name. Empty —
 * no selector — for anyone else, on a customer website, and while fewer
 * than two workspaces have a dashboard site (a single-tenant install).
 */
export async function listDashboardWorkspaces(
  stores: WorkspaceScopeStores,
  viewer: WorkspaceViewer,
  website: Website,
): Promise<WorkspaceOption[]> {
  if (!canWidenScope(viewer, website)) {
    return [];
  }
  const sites = await dashboardSites(stores, await stores.tenants.getAll());
  if (sites.length < 2) {
    return [];
  }
  return sites
    .map(({ tenant }) => ({
      id: tenant._id,
      name: tenant.name || tenant._id,
      current: tenant._id === viewer.tenantId,
    }))
    .sort(
      (a, b) =>
        Number(b.current) - Number(a.current) || a.name.localeCompare(b.name),
    );
}

/**
 * The sites a heatmap-family read covers. Without `workspace` (or with the
 * viewer's own) it is `website` alone, exactly as before. Otherwise the
 * viewer must be a platform owner reading from their dashboard site, and the
 * read covers the dashboard site of the named workspace, or of every
 * workspace (`all`). Anything else answers 404, as an unknown website does:
 * the guard is here, not in the selector's visibility.
 */
export async function resolveWorkspaceScope(
  stores: WorkspaceScopeStores,
  viewer: WorkspaceViewer,
  website: Website,
  workspace: string | undefined,
): Promise<WorkspaceScope> {
  if (!workspace || workspace === viewer.tenantId) {
    return {
      sites: [{ tenantId: website.tenantId, website }],
      foreign: false,
    };
  }
  if (!canWidenScope(viewer, website)) {
    throw notFound();
  }
  if (workspace === ALL_WORKSPACES) {
    const sites = await dashboardSites(stores, await stores.tenants.getAll());
    return {
      sites: sites.map((site) => ({
        tenantId: site.tenant._id,
        website: site.website,
      })),
      foreign: true,
    };
  }
  const tenant = await stores.tenants.get(workspace);
  const [site] = tenant ? await dashboardSites(stores, [tenant]) : [];
  if (!site) {
    throw notFound();
  }
  return {
    sites: [{ tenantId: site.tenant._id, website: site.website }],
    foreign: true,
  };
}
