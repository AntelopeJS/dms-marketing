import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  type RequestContext,
} from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { AuthTenantMember } from "@antelopejs/interface-dms/guards";
import type { Website } from "@/db/tables/websites.table";
import {
  campaignsPayload,
  channelsPayload,
} from "@/services/acquisition-report";
import { resolveContextWebsite } from "@/services/context";
import {
  devicesPayload,
  goalEventNames,
  isKpiMetric,
  isTopGroup,
  kpiPayload,
  qualityItems,
  topGroupPayload,
  trafficPayload,
} from "@/services/dashboard";
import {
  periodQueryOf,
  resolveCompareWindow,
  resolveQueryWindow,
} from "@/services/period";
import { queryString } from "@/services/query-param";
import {
  mergeDimension,
  percentChange,
  rankEntries,
  type RollupRead,
  readRollupsWithComparison,
  shareOf,
} from "@/services/rollups";
import { isTopDimension, type TopDimension } from "@/types";
import { API_BASE_PATH, HTTP_BAD_REQUEST } from "@/types/constants";

const INVALID_METRIC_MESSAGE = "$page.marketing.errors.invalid_metric";

interface ScopedRead {
  website: Website;
  read: RollupRead;
}

async function readScope(
  context: RequestContext,
  user: User,
  website: unknown,
): Promise<ScopedRead> {
  const resolved = await resolveContextWebsite(context, user, website);
  const query = periodQueryOf(context.url);
  const read = await readRollupsWithComparison(
    resolved,
    resolveQueryWindow(query),
    resolveCompareWindow(query),
  );
  return { website: resolved, read };
}

const TOP_LIST_DIMENSIONS: ReadonlySet<TopDimension> = new Set([
  "topReferrers",
  "topUtmContents",
  "topUtmTerms",
  "topUtmSources",
  "topUtmMediums",
  "topUtmCampaigns",
  "topBrowsers",
  "topPages",
]);

const DEFAULT_TOP_LIMIT = 5;
const MAX_TOP_LIMIT = 50;

function topLimit(raw: unknown): number {
  const parsed = Number.parseInt(queryString(raw) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, MAX_TOP_LIMIT)
    : DEFAULT_TOP_LIMIT;
}

/**
 * The routes the stock blocks of the analytics pages read: each answers in
 * the shape its block expects (`KpiCard`, `ChartCard`, `TopListCard`) or, for
 * the module's own blocks, in a shape documented next to their payload
 * builder. Every route follows the marketing context: `website` when given,
 * else the caller's selected website, and the `from`/`to`/`compareFrom`/
 * `compareTo` the period scope appends.
 */
export class BlocksController extends Controller(`${API_BASE_PATH}/blocks`) {
  @Get("kpi")
  async kpi(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("metric", "query") metric?: string,
    @Parameter("website", "query") website?: string,
  ) {
    if (!isKpiMetric(metric)) {
      throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_METRIC_MESSAGE);
    }
    const { read } = await readScope(context, user, website);
    return kpiPayload(read, metric);
  }

  @Get("traffic")
  async traffic(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("metric", "query") metric?: string,
    @Parameter("website", "query") website?: string,
  ) {
    const wanted = metric ?? "sessions";
    if (!isKpiMetric(wanted)) {
      throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_METRIC_MESSAGE);
    }
    const { read } = await readScope(context, user, website);
    return trafficPayload(read, wanted);
  }

  @Get("quality")
  async quality(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    const { read } = await readScope(context, user, website);
    return { items: qualityItems(read) };
  }

  @Get("devices")
  async devices(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    const { read } = await readScope(context, user, website);
    return { items: devicesPayload(read) };
  }

  @Get("tops")
  async tops(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("group", "query") group?: string,
    @Parameter("website", "query") website?: string,
  ) {
    if (!isTopGroup(group)) {
      throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_METRIC_MESSAGE);
    }
    const { website: site, read } = await readScope(context, user, website);
    const tabs = topGroupPayload(read, group);
    const goals = group === "events" ? await goalEventNames(site) : new Set();
    for (const item of tabs.flatMap((tab) => tab.items)) {
      if (goals.has(item.id)) {
        item.tag = "$page.marketing.overview.groups.events.goal";
      }
    }
    return { tabs };
  }

  /** A `TopListCard` over one rollup dimension: `{ items }`, share as the description. */
  @Get("top")
  async top(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("dimension", "query") dimension?: string,
    @Parameter("limit", "query") limit?: string,
    @Parameter("website", "query") website?: string,
  ) {
    if (!isTopDimension(dimension) || !TOP_LIST_DIMENSIONS.has(dimension)) {
      throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_METRIC_MESSAGE);
    }
    const { read } = await readScope(context, user, website);
    const merged = mergeDimension(read.rows, dimension);
    const previous = read.compare
      ? mergeDimension(read.compareRows, dimension)
      : undefined;
    const total = Object.values(merged).reduce((sum, v) => sum + v, 0);
    return {
      items: rankEntries(merged, topLimit(limit)).map(({ key, value }) => ({
        id: key,
        title: key,
        value,
        description: `${shareOf(value, total).toFixed(1)}%`,
        delta: previous ? percentChange(value, previous[key]) : null,
      })),
    };
  }

  @Get("channels")
  async channels(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    const { read } = await readScope(context, user, website);
    return channelsPayload(read);
  }

  @Get("campaigns")
  async campaigns(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("search", "query") search?: string,
    @Parameter("website", "query") website?: string,
  ) {
    const { read } = await readScope(context, user, website);
    return campaignsPayload(read, queryString(search));
  }
}
