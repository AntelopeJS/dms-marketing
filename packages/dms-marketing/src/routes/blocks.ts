import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  type RequestContext,
} from "@antelopejs/interface-api";
import type { User } from "@antelopejs/interface-dms/auth/db";
import type { BannerContent } from "@antelopejs/interface-dms/base/banner";
import { AuthTenantMember } from "@antelopejs/interface-dms/guards";
import type { Website } from "@/db/tables/websites.table";
import {
  campaignNotice,
  campaignTablePayload,
  channelsPayload,
  compareHasTops,
  isCampaignNoticeKind,
  readCampaignsReport,
} from "@/services/acquisition-report";
import { percentText } from "@/services/composed";
import {
  loadWebsiteActivity,
  resolveContextWebsite,
  toContextWebsite,
} from "@/services/context";
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
  type ComparisonKind,
  comparisonKindOf,
  periodQueryOf,
  resolveCompareWindow,
  resolveQueryWindow,
} from "@/services/period";
import { queryString } from "@/services/query-param";
import { collectionPausedNotice } from "@/services/settings";
import {
  mergeDimension,
  percentChange,
  rankEntries,
  type RollupRead,
  readRollupsWithComparison,
  shareOf,
  sumRollups,
} from "@/services/rollups";
import { isTopDimension, type TopDimension } from "@/types";
import {
  API_BASE_PATH,
  HTTP_BAD_REQUEST,
  MARKETING_MODULE_PATH,
} from "@/types/constants";

const INVALID_METRIC_MESSAGE = "$page.marketing.errors.invalid_metric";

interface ScopedRead {
  website: Website;
  read: RollupRead;
  /** What the changes are measured against, as their labels name it. */
  comparison: ComparisonKind;
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
  return { website: resolved, read, comparison: comparisonKindOf(query) };
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
 * builder. Every route follows the marketing context: the `website` of the
 * page URL (the caller's saved website without one), and the `from`/`to`/
 * `compareFrom`/`compareTo` the period scope appends.
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
    const scope = await readScope(context, user, website);
    return trafficPayload(scope.read, wanted, scope.website, scope.comparison);
  }

  @Get("quality")
  async quality(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    const { read, comparison } = await readScope(context, user, website);
    return { items: qualityItems(read, comparison) };
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

  /**
   * A `TopListCard` over one rollup dimension: `{ items }`, the share of the
   * period's sessions (pageviews for pages) as the description — the base
   * the channels card and the campaigns table use. No delta when the comparison days lost their
   * top maps.
   */
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
    const previous =
      read.compare && compareHasTops(read)
        ? mergeDimension(read.compareRows, dimension)
        : undefined;
    const totals = sumRollups(read.rows);
    const base = dimension === "topPages" ? totals.pageviews : totals.sessions;
    return {
      items: rankEntries(merged, topLimit(limit)).map(({ key, value }) => ({
        id: key,
        title: key,
        value,
        description: percentText(shareOf(value, base)),
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

  /**
   * The campaigns table (`TableView.fromSource`): `{ results, total }` for
   * its list query — `search`, `filter_channel=<mode>:<channel>`, `sortKey`/
   * `sortDirection`, `offset`/`limit` — run over every row of the period.
   */
  @Get("campaigns/rows")
  async campaignRows(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    const params = context.url.searchParams;
    const number = (name: string) =>
      Number.parseInt(params.get(name) ?? "", 10) || 0;
    const resolved = await resolveContextWebsite(context, user, website);
    const window = resolveQueryWindow(periodQueryOf(context.url));
    return campaignTablePayload(await readCampaignsReport(resolved, window), {
      search: queryString(params.get("search")),
      channel: queryString(params.get("filter_channel")),
      sortKey: queryString(params.get("sortKey")),
      sortDirection: queryString(params.get("sortDirection")),
      offset: number("offset"),
      limit: number("limit"),
    });
  }

  /** A notice above the campaigns table, for a stock `Banner`: `?kind=tagged|missing`. */
  @Get("campaigns/notice")
  async campaignNoticeBanner(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("kind", "query") kind?: string,
    @Parameter("website", "query") website?: string,
  ) {
    if (!isCampaignNoticeKind(kind)) {
      throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_METRIC_MESSAGE);
    }
    const resolved = await resolveContextWebsite(context, user, website);
    const window = resolveQueryWindow(periodQueryOf(context.url));
    return campaignNotice(await readCampaignsReport(resolved, window), kind);
  }

  /**
   * A `Banner` over an analytics page while its website has sent nothing
   * yet: the page would only show zeros, so it says why and links to the
   * install guide. `null` once the first pageview arrived.
   */
  @Get("website-notice")
  async websiteNotice(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    const resolved = await resolveContextWebsite(context, user, website);
    const activity = await loadWebsiteActivity(resolved.tenantId, [resolved]);
    if (toContextWebsite(resolved, activity).state !== "waiting") {
      return null;
    }
    return {
      tone: "warning",
      icon: "i-ph-plugs",
      title: {
        key: "$page.marketing.websites.waiting_title",
        params: { name: resolved.name },
      },
      description: "$page.marketing.websites.waiting_notice",
      actions: [
        {
          label: "$page.marketing.websites.waiting_install",
          to: `${MARKETING_MODULE_PATH}/install?website=${encodeURIComponent(resolved._id)}`,
          icon: "i-ph-code",
        },
      ],
    } satisfies BannerContent;
  }

  /**
   * A `Banner` over the Websites grid and in the install guide while the
   * module-wide collection is paused; `null` while it collects.
   */
  @Get("collection-notice")
  collectionNotice(@AuthTenantMember() _user: User) {
    return collectionPausedNotice();
  }
}
