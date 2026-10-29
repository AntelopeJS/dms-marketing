import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import {
  MarketingImportsModel,
  MarketingPreferencesModel,
  MarketingSessionsModel,
  WebsitesModel,
} from "@/db";
import type { Website } from "@/db/tables/websites.table";
import { HTTP_NOT_FOUND } from "@/types/constants";
import { queryString } from "./query-param";
import { listTenantWebsites, requireTenantWebsite } from "./tenant-website";

const NO_WEBSITE_MESSAGE = "$page.marketing.errors.no_website";

/**
 * The state a website shows in the context bar and on its card: `live` once a
 * pageview arrived, `waiting` until then, `paused` when its own switch is off.
 * `imported` when it has data but its latest activity came from an import
 * (`ImportAnalytics`): no newer than what its completed imports filled, so
 * nothing proves the tag collects.
 */
export type WebsiteState = "live" | "imported" | "waiting" | "paused";

export interface ContextWebsite {
  id: string;
  name: string;
  domain: string;
  state: WebsiteState;
  /**
   * Epoch milliseconds of the last tracked activity, imported or live, null
   * before the first.
   */
  lastActivityAt: number | null;
}

/** What the state of a set of websites is read from. */
export interface WebsiteActivity {
  /** Epoch ms of each website's last session activity, imported or live. */
  lastActivity: ReadonlyMap<string, number>;
  /** Epoch ms up to which each website's completed imports filled it. */
  importedThrough: ReadonlyMap<string, number>;
}

export interface MarketingContextPayload {
  websites: ContextWebsite[];
  /** The website the blocks read, null while the tenant has none. */
  selectedId: string | null;
}

function websiteState(
  website: Website,
  lastActivityAt: number | null,
  importedThrough: number | undefined,
): WebsiteState {
  if (!website.trackingEnabled) {
    return "paused";
  }
  if (lastActivityAt === null) {
    return "waiting";
  }
  return importedThrough !== undefined && lastActivityAt <= importedThrough
    ? "imported"
    : "live";
}

export function toContextWebsite(
  website: Website,
  activity: WebsiteActivity,
): ContextWebsite {
  const lastActivityAt = activity.lastActivity.get(website._id) ?? null;
  return {
    id: website._id,
    name: website.name,
    domain: website.domain,
    state: websiteState(
      website,
      lastActivityAt,
      activity.importedThrough.get(website._id),
    ),
    lastActivityAt,
  };
}

/** What the import boundaries of these websites are. */
export async function loadImportedThrough(
  tenantId: string,
  websites: Website[],
): Promise<Map<string, number>> {
  return GetModel(MarketingImportsModel, tenantId).getImportedThroughByWebsites(
    websites.map((website) => website._id),
  );
}

export async function loadWebsiteActivity(
  tenantId: string,
  websites: Website[],
): Promise<WebsiteActivity> {
  if (websites.length === 0) {
    return { lastActivity: new Map(), importedThrough: new Map() };
  }
  const [lastActivity, importedThrough] = await Promise.all([
    GetModel(MarketingSessionsModel, tenantId).getLastActivityByWebsites(
      websites.map((website) => website._id),
    ),
    loadImportedThrough(tenantId, websites),
  ]);
  return { lastActivity, importedThrough };
}

async function preferredWebsiteId(
  tenantId: string,
  user: User,
): Promise<string | undefined> {
  return GetModel(MarketingPreferencesModel, tenantId).getWebsiteId(user._id);
}

/**
 * The website a read is about: the `website` parameter, which the analytics
 * pages always send, else the caller's last pick while it still belongs to
 * the tenant, else the most recently active site. 404 while the tenant has
 * none.
 */
export async function resolveContextWebsite(
  context: RequestContext,
  user: User,
  website: unknown,
): Promise<Website> {
  const wanted = queryString(website);
  if (wanted) {
    return requireTenantWebsite(context, wanted);
  }
  const tenantId = getRequestTenantId(context);
  const preferred = await preferredWebsiteId(tenantId, user);
  const saved = preferred
    ? await GetModel(WebsitesModel).get(preferred)
    : undefined;
  if (saved?.tenantId === tenantId) {
    return saved;
  }
  const [mostActive] = await listTenantWebsites(tenantId);
  if (!mostActive) {
    throw new HTTPResult(HTTP_NOT_FOUND, NO_WEBSITE_MESSAGE);
  }
  return mostActive;
}

export async function loadMarketingContext(
  context: RequestContext,
  user: User,
): Promise<MarketingContextPayload> {
  const tenantId = getRequestTenantId(context);
  const all = await GetModel(WebsitesModel).getByTenant(tenantId);
  const activity = await loadWebsiteActivity(tenantId, all);
  const { lastActivity } = activity;
  const websites = [...all].sort(
    (a, b) => (lastActivity.get(b._id) ?? 0) - (lastActivity.get(a._id) ?? 0),
  );
  const preferred = await preferredWebsiteId(tenantId, user);
  const selected =
    websites.find((site) => site._id === preferred) ?? websites[0];
  return {
    websites: websites.map((site) => toContextWebsite(site, activity)),
    selectedId: selected?._id ?? null,
  };
}

export async function selectContextWebsite(
  context: RequestContext,
  user: User,
  websiteId: string,
): Promise<void> {
  const website = await requireTenantWebsite(context, websiteId);
  await GetModel(
    MarketingPreferencesModel,
    getRequestTenantId(context),
  ).setWebsiteId(user._id, website._id);
}
