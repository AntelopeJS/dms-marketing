import {
  Context,
  Controller,
  Delete,
  Get,
  HTTPResult,
  Parameter,
  type RequestContext,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import {
  AuthTenantMember,
  AuthTenantOwner,
} from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { getConfig } from "@/config";
import { type DayTops, WebsiteStatisticsModel, WebsitesModel } from "@/db";
import type { WebsiteStatistics } from "@/db/tables/website_statistics.table";
import type { Website } from "@/db/tables/websites.table";
import {
  type CampaignKeyParts,
  splitCampaignKey,
} from "@/services/acquisition";
import { isGeoipActive } from "@/services/geoip";
import {
  computeClickHeatmap,
  computePageActivity,
  computeScrollDepth,
  countHeatmapData,
  resetHeatmap as resetHeatmapEvents,
} from "@/services/heatmap";
import {
  periodQueryOf,
  type QueryWindow,
  resolveQueryWindow,
} from "@/services/period";
import { queryString } from "@/services/query-param";
import { readPageSnapshot } from "@/services/snapshots";
import { requireTenantWebsite } from "@/services/tenant-website";
import { parseTrackedUrl } from "@/services/url";
import {
  byDimension,
  isSnapshotLayout,
  type MarketingDayCounters,
  type MarketingDayStatistics,
  type SnapshotLayout,
  type TopDimension,
  type TopEntries,
} from "@/types";
import {
  API_BASE_PATH,
  DEFAULT_PAGES_LIST_LIMIT,
  HTTP_BAD_REQUEST,
  MAX_PAGES_LIST_LIMIT,
} from "@/types/constants";

const MISSING_PATH_MESSAGE = "$page.marketing.errors.missing_path";
const OVERVIEW_CARD_TOP_ENTRIES = 10;
const DEFAULT_SNAPSHOT_LAYOUT: SnapshotLayout = "desktop";

type OverviewTotals = Omit<MarketingDayCounters, "day">;

interface OverviewSummary {
  totals: OverviewTotals;
  days: MarketingDayStatistics[];
  /** Same role as `trackerEnabled` on /pages: lets the dashboard tell "no
   * countries yet" from "no GeoIP database configured" and hide the card. */
  geoipEnabled: boolean;
}

type OverviewPayload = OverviewSummary & Record<TopDimension, TopEntries>;

function sumTotals(days: MarketingDayStatistics[]): OverviewTotals {
  return days.reduce<OverviewTotals>(
    (totals, day) => ({
      pageviews: totals.pageviews + day.pageviews,
      sessions: totals.sessions + day.sessions,
      newVisitors: totals.newVisitors + day.newVisitors,
      customEvents: totals.customEvents + day.customEvents,
      bouncedSessions: totals.bouncedSessions + day.bouncedSessions,
      sessionDurationMs: totals.sessionDurationMs + day.sessionDurationMs,
    }),
    {
      pageviews: 0,
      sessions: 0,
      newVisitors: 0,
      customEvents: 0,
      bouncedSessions: 0,
      sessionDurationMs: 0,
    },
  );
}

/** Sum one dimension's per-day maps into a single map over the window. */
function mergeDimension(
  days: ReadonlyArray<DayTops>,
  dimension: TopDimension,
): TopEntries {
  const merged: TopEntries = {};
  for (const day of days) {
    for (const [key, count] of Object.entries(day[dimension] ?? {})) {
      merged[key] = (merged[key] ?? 0) + count;
    }
  }
  return merged;
}

function mergeTops(
  days: ReadonlyArray<DayTops>,
  dimension: TopDimension,
): TopEntries {
  const top = Object.entries(mergeDimension(days, dimension))
    .sort((a, b) => b[1] - a[1])
    .slice(0, OVERVIEW_CARD_TOP_ENTRIES);
  return Object.fromEntries(top);
}

/**
 * Row → wire shape: a rollup row carries its maps under `tops`, the wire
 * keeps the flat day object dms-api's chart plumbing expects. The default
 * covers maps emptied past the readable window.
 */
function toDayStatistics(row: WebsiteStatistics): MarketingDayStatistics {
  return {
    day: row.day,
    pageviews: row.pageviews,
    sessions: row.sessions,
    newVisitors: row.newVisitors,
    customEvents: row.customEvents,
    bouncedSessions: row.bouncedSessions ?? 0,
    sessionDurationMs: row.sessionDurationMs ?? 0,
    ...byDimension<TopEntries>((dimension) => row.tops?.[dimension] ?? {}),
  };
}

/** Full rollup rows — the overview alone needs the scalars and every map. */
async function loadDaysInRange(
  website: Website,
  window: QueryWindow,
): Promise<MarketingDayStatistics[]> {
  const rows = await GetModel(
    WebsiteStatisticsModel,
    website.tenantId,
  ).getDaysBetween(website._id, window.firstDay, window.lastDay);
  return rows.map(toDayStatistics);
}

/**
 * The maps a table surface actually charts, and nothing else: /pages reads
 * one dimension of the sixteen, /campaigns five.
 */
async function loadTopsInRange(
  website: Website,
  window: QueryWindow,
  dimensions: readonly TopDimension[],
): Promise<DayTops[]> {
  return GetModel(WebsiteStatisticsModel, website.tenantId).getTopsSince(
    website._id,
    window.firstDay,
    dimensions,
    window.lastDay,
  );
}

const PAGES_DIMENSIONS = ["topPages"] as const;

const CAMPAIGNS_DIMENSIONS = [
  "topCampaigns",
  "topChannels",
  "topUtmTerms",
  "topUtmContents",
  "topReferrers",
] as const;

interface CampaignRow extends CampaignKeyParts {
  sessions: number;
}

function campaignMatches(row: CampaignRow, needle: string): boolean {
  if (!needle) {
    return true;
  }
  return [row.source, row.medium, row.campaign].some((part) =>
    part?.toLowerCase().includes(needle),
  );
}

function clampLimit(raw: unknown): number {
  const parsed = Number.parseInt(queryString(raw) ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PAGES_LIST_LIMIT;
  }
  return Math.min(parsed, MAX_PAGES_LIST_LIMIT);
}

/**
 * Website scope of a heatmap-family read. Without `website` the events of
 * every website of the tenant are merged for the path — exact only while a
 * tenant tracks a single site, so prefer passing it. Kept optional because
 * integrations outside this repository were never surveyed.
 */
async function resolveHeatmapScope(
  context: RequestContext,
  website: unknown,
): Promise<{ tenantId: string; websiteIds: string[] }> {
  const tenantId = getRequestTenantId(context);
  const wantedWebsite = queryString(website);
  const websiteIds = wantedWebsite
    ? [(await requireTenantWebsite(context, wantedWebsite))._id]
    : await GetModel(WebsitesModel).listIdsByTenant(tenantId);
  return { tenantId, websiteIds };
}

/** The days a heatmap-family read covers: the page's `from`/`to`, else `period`. */
function requestWindow(context: RequestContext): QueryWindow {
  return resolveQueryWindow(periodQueryOf(context.url));
}

/**
 * The path a heatmap-family route reads, reduced the way the tracker stores
 * it (pathname only, leading slash, no query or fragment) — so a path typed
 * as `demo/pricing` or pasted with its query string finds the page's clicks.
 */
function requestedPath(path: unknown): string {
  const wanted = queryString(path);
  if (!wanted) {
    throw new HTTPResult(HTTP_BAD_REQUEST, MISSING_PATH_MESSAGE);
  }
  return parseTrackedUrl(wanted).path;
}

/**
 * Path of a reset: absent means the whole site; present but blank is a
 * mistake to refuse, never a site-wide delete.
 */
function resetPath(context: RequestContext): string | undefined {
  const params = context.url.searchParams;
  return params.has("path") ? requestedPath(params.get("path")) : undefined;
}

type PagesSort = "views" | "clicks";

interface PageRow {
  path: string;
  pageviews: number;
  clicks: number;
  sampled: number;
}

/**
 * Dashboard reads. Overview is rollup only — raw events never back it;
 * heatmap is the deliberate exception, backed by the short-retention raw
 * window.
 */
export class StatsController extends Controller(`${API_BASE_PATH}/stats`) {
  @Get("overview")
  async overview(
    @AuthTenantMember() _user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    const websiteDoc = await requireTenantWebsite(
      context,
      queryString(website),
    );
    const inRange = await loadDaysInRange(websiteDoc, requestWindow(context));

    const payload: OverviewPayload = {
      totals: sumTotals(inRange),
      days: inRange,
      geoipEnabled: isGeoipActive(),
      ...byDimension<TopEntries>((dimension) => mergeTops(inRange, dimension)),
    };
    return payload;
  }

  /**
   * Paths actually visited on a site over the window — observed traffic,
   * never a route registry or a sitemap. Top maps are capped
   * (MAX_ENTRIES_PER_TOP_MAP) and emptied past TOP_MAPS_RETENTION_DAYS, so a
   * missing path is not "no clicks" — hence the surface also accepts a typed
   * path. Each path carries its clicks and sampled views (raw events, same
   * window), and paths with clicks but no rollup entry are listed too.
   * `sampleRate` is the measured share of sampled page loads — the rate the
   * snippet really applies — and `trackerEnabled` tells "collection off".
   * `sort=clicks` orders by clicks, anything else by views.
   */
  @Get("pages")
  // The parameter list of a decorated handler is its HTTP surface, not an
  // argument list to shorten.
  // oxlint-disable-next-line eslint/max-params
  async pages(
    @AuthTenantMember() _user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
    @Parameter("search", "query") search?: string,
    @Parameter("limit", "query") limit?: string,
    @Parameter("sort", "query") sort?: string,
  ) {
    const websiteDoc = await requireTenantWebsite(
      context,
      queryString(website),
    );
    const window = requestWindow(context);
    const [inRange, activity] = await Promise.all([
      GetModel(WebsiteStatisticsModel, websiteDoc.tenantId).getTopsSince(
        websiteDoc._id,
        window.firstDay,
        PAGES_DIMENSIONS,
        window.lastDay,
      ),
      computePageActivity(websiteDoc.tenantId, websiteDoc._id, window),
    ]);

    const views = mergeDimension(inRange, "topPages");
    const paths = new Set([...Object.keys(views), ...activity.clicks.keys()]);
    const needle = queryString(search)?.toLowerCase() ?? "";
    const order: PagesSort =
      queryString(sort) === "clicks" ? "clicks" : "views";
    const matching = [...paths]
      .filter((path) => !needle || path.toLowerCase().includes(needle))
      .map((path): PageRow => ({
        path,
        pageviews: views[path] ?? 0,
        clicks: activity.clicks.get(path) ?? 0,
        sampled: activity.sampled.get(path) ?? 0,
      }))
      .sort((a, b) =>
        order === "clicks"
          ? b.clicks - a.clicks || b.pageviews - a.pageviews
          : b.pageviews - a.pageviews || b.clicks - a.clicks,
      );

    const max = clampLimit(limit);
    return {
      pages: matching.slice(0, max),
      total: matching.length,
      truncated: matching.length > max,
      sampleRate: activity.sampleRate,
      trackerEnabled: getConfig().trackerEnabled,
    };
  }

  /**
   * The acquisition surface: sessions by channel, and the UTM campaign table
   * as (source, medium, campaign) triples — the composite `topCampaigns` key
   * is split back server-side so its separator stays a storage detail. Same
   * caps as every rollup read: a day keeps at most MAX_ENTRIES_PER_TOP_MAP
   * campaign triples.
   */
  @Get("campaigns")
  // The parameter list of a decorated handler is its HTTP surface, not an
  // argument list to shorten.
  // oxlint-disable-next-line eslint/max-params
  async campaigns(
    @AuthTenantMember() _user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
    @Parameter("search", "query") search?: string,
    @Parameter("limit", "query") limit?: string,
  ) {
    const websiteDoc = await requireTenantWebsite(
      context,
      queryString(website),
    );
    const inRange = await loadTopsInRange(
      websiteDoc,
      requestWindow(context),
      CAMPAIGNS_DIMENSIONS,
    );

    const needle = queryString(search)?.toLowerCase() ?? "";
    const rows = Object.entries(mergeDimension(inRange, "topCampaigns"))
      .map(([key, sessions]): CampaignRow => ({
        ...splitCampaignKey(key),
        sessions,
      }))
      .filter((row) => campaignMatches(row, needle))
      .sort((a, b) => b.sessions - a.sessions);

    const max = clampLimit(limit);
    return {
      // Exhaustive, not a top list: the classifier only ever mints the five
      // MARKETING_CHANNELS keys.
      channels: mergeDimension(inRange, "topChannels"),
      campaigns: rows.slice(0, max),
      truncated: rows.length > max,
      terms: mergeTops(inRange, "topUtmTerms"),
      contents: mergeTops(inRange, "topUtmContents"),
      // Referrer domains of every session that carried one — all channels,
      // not just the donut's referral slice.
      referrers: mergeTops(inRange, "topReferrers"),
    };
  }

  @Get("heatmap")
  async heatmap(
    @AuthTenantMember() _user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
    @Parameter("path", "query") path?: string,
  ) {
    const wantedPath = requestedPath(path);
    const { tenantId, websiteIds } = await resolveHeatmapScope(
      context,
      website,
    );
    return computeClickHeatmap(
      tenantId,
      websiteIds,
      wantedPath,
      requestWindow(context),
    );
  }

  /** Scroll-depth distribution of one path — the heatmap's second overlay,
   * same raw-events window, sampling and website merge rule as the clicks. */
  @Get("scroll")
  async scrollDepth(
    @AuthTenantMember() _user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
    @Parameter("path", "query") path?: string,
  ) {
    const wantedPath = requestedPath(path);
    const { tenantId, websiteIds } = await resolveHeatmapScope(
      context,
      website,
    );
    return computeScrollDepth(
      tenantId,
      websiteIds,
      wantedPath,
      requestWindow(context),
    );
  }

  /**
   * Backdrop of one path: the capture at the asked layout, else the nearest
   * one, else null. Never an error — "not captured yet" is a state the
   * surface explains. `website` is required: a capture belongs to one site.
   */
  @Get("snapshot")
  async snapshot(
    @AuthTenantMember() _user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
    @Parameter("path", "query") path?: string,
    @Parameter("layout", "query") layout?: string,
  ) {
    const wantedPath = requestedPath(path);
    const websiteDoc = await requireTenantWebsite(
      context,
      queryString(website),
    );
    const wantedLayout = queryString(layout);
    return {
      snapshot: await readPageSnapshot(
        websiteDoc.tenantId,
        websiteDoc._id,
        wantedPath,
        isSnapshotLayout(wantedLayout) ? wantedLayout : DEFAULT_SNAPSHOT_LAYOUT,
      ),
    };
  }

  /**
   * What the reset below would delete — clicks and scrolls (`events`) and
   * captures (`snapshots`), every period — for its confirmation dialog.
   * Same scope rules as the reset.
   */
  @Get("heatmap/count")
  async countHeatmap(
    @AuthTenantOwner() _user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    const websiteDoc = await requireTenantWebsite(
      context,
      queryString(website),
    );
    return countHeatmapData(
      websiteDoc.tenantId,
      websiteDoc._id,
      resetPath(context),
    );
  }

  /**
   * Unlike the reads above, `website` is required: deleting across every site
   * of the tenant because a query parameter was omitted is not a merge, it is
   * a surprise. Without `path` the whole site's click and scroll history goes
   * — the "pages were redesigned" case the reset exists for; a blank `path`
   * is refused rather than read as "no path". Answers `{events, snapshots}`
   * deleted (`deleted` repeats `events` for older callers).
   */
  @Delete("heatmap")
  async resetHeatmap(
    @AuthTenantOwner() _user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    const path = resetPath(context);
    const websiteDoc = await requireTenantWebsite(
      context,
      queryString(website),
    );
    const deleted = await resetHeatmapEvents(
      websiteDoc.tenantId,
      websiteDoc._id,
      path,
    );
    return { ...deleted, deleted: deleted.events };
  }
}
