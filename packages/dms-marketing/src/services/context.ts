import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { MarketingPreferencesModel, MarketingSessionsModel } from "@/db";
import type { Website } from "@/db/tables/websites.table";
import { HTTP_NOT_FOUND } from "@/types/constants";
import { queryString } from "./query-param";
import { listTenantWebsites, requireTenantWebsite } from "./tenant-website";

const NO_WEBSITE_MESSAGE = "$page.marketing.errors.no_website";

/**
 * The state a website shows in the context bar and on its card: `live` once a
 * pageview arrived, `waiting` until then, `paused` when its own switch is off.
 */
export type WebsiteState = "live" | "waiting" | "paused";

export interface ContextWebsite {
  id: string;
  name: string;
  domain: string;
  state: WebsiteState;
  /** Epoch milliseconds of the last tracked activity, null before the first. */
  lastActivityAt: number | null;
}

export interface MarketingContextPayload {
  websites: ContextWebsite[];
  /** The website the blocks read, null while the tenant has none. */
  selectedId: string | null;
}

function websiteState(website: Website, lastActivityAt: number | null) {
  if (!website.trackingEnabled) {
    return "paused";
  }
  return lastActivityAt === null ? "waiting" : "live";
}

export function toContextWebsite(
  website: Website,
  activity: ReadonlyMap<string, number>,
): ContextWebsite {
  const lastActivityAt = activity.get(website._id) ?? null;
  return {
    id: website._id,
    name: website.name,
    domain: website.domain,
    state: websiteState(website, lastActivityAt),
    lastActivityAt,
  };
}

export async function loadWebsiteActivity(
  tenantId: string,
  websites: Website[],
): Promise<Map<string, number>> {
  if (websites.length === 0) {
    return new Map();
  }
  return GetModel(MarketingSessionsModel, tenantId).getLastActivityByWebsites(
    websites.map((website) => website._id),
  );
}

async function preferredWebsiteId(
  tenantId: string,
  user: User,
): Promise<string | undefined> {
  return GetModel(MarketingPreferencesModel, tenantId).getWebsiteId(user._id);
}

/**
 * The website a read without a `website` parameter is about: the caller's
 * last pick while it still belongs to the tenant, else the most recently
 * active site. 404 while the tenant has none.
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
  const websites = await listTenantWebsites(tenantId);
  const preferred = await preferredWebsiteId(tenantId, user);
  const resolved =
    websites.find((site) => site._id === preferred) ?? websites[0];
  if (!resolved) {
    throw new HTTPResult(HTTP_NOT_FOUND, NO_WEBSITE_MESSAGE);
  }
  return resolved;
}

export async function loadMarketingContext(
  context: RequestContext,
  user: User,
): Promise<MarketingContextPayload> {
  const tenantId = getRequestTenantId(context);
  const websites = await listTenantWebsites(tenantId);
  const activity = await loadWebsiteActivity(tenantId, websites);
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
