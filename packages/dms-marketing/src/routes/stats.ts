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
import { TenantModel } from "@antelopejs/interface-dms/db";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { getConfig } from "@/config";
import { type DayTops, WebsiteStatisticsModel, WebsitesModel } from "@/db";
import type { WebsiteStatistics } from "@/db/tables/website_statistics.table";
import type { Website } from "@/db/tables/websites.table";
import { isGeoipActive } from "@/services/geoip";
import {
  computeClickHeatmap,
  computeScopedPageActivity,
  computeScrollDepth,
  countHeatmapData,
  mergeClickHeatmaps,
  mergeScrollDepths,
  resetHeatmap as resetHeatmapEvents,
} from "@/services/heatmap";
import {
  periodQueryOf,
  type QueryWindow,
  resolveQueryWindow,
} from "@/services/period";
import { queryString, type QueryParameter } from "@/services/query-param";
import {
  type PageSnapshotSummary,
  readScopedPageSnapshot,
  summarizeScopedSnapshots,
} from "@/services/snapshots";
import { requireTenantWebsite } from "@/services/tenant-website";
import {
  listDashboardWorkspaces,
  resolveWorkspaceScope,
  type ScopedSite,
  type WorkspaceScope,
  type WorkspaceScopeStores,
  type WorkspaceViewer,
} from "@/services/workspace-scope";
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
  /** Same role as `trackerEnabled` on /pages: tells "no countries yet" from
   * "no GeoIP database configured". Imported sessions carry their own
   * country, so `topCountries` can have entries while this is false. */
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

const PAGES_DIMENSIONS = ["topPages"] as const;

function clampLimit(raw: QueryParameter): number {
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
  website: QueryParameter,
): Promise<{ tenantId: string; websiteIds: string[] }> {
  const tenantId = getRequestTenantId(context);
  const wantedWebsite = queryString(website);
  const websiteIds = wantedWebsite
    ? [(await requireTenantWebsite(context, wantedWebsite))._id]
    : await GetModel(WebsitesModel).listIdsByTenant(tenantId);
  return { tenantId, websiteIds };
}

function scopeStores(): WorkspaceScopeStores {
  return { tenants: GetModel(TenantModel), websites: GetModel(WebsitesModel) };
}

function viewerOf(context: RequestContext, user: User): WorkspaceViewer {
  return { owner: user.owner, tenantId: getRequestTenantId(context) };
}

/**
 * The sites a read of `website` covers under `workspace` (see
 * resolveWorkspaceScope): the website alone without it. `website` must be
 * the caller's either way.
 */
async function requestScope(
  context: RequestContext,
  user: User,
  website: QueryParameter,
  workspace: QueryParameter,
): Promise<WorkspaceScope> {
  return resolveWorkspaceScope(
    scopeStores(),
    viewerOf(context, user),
    await requireTenantWebsite(context, queryString(website)),
    queryString(workspace),
  );
}

function siteRefs(sites: ScopedSite[]) {
  return sites.map((site) => ({
    tenantId: site.tenantId,
    websiteId: site.website._id,
  }));
}

/** The days a heatmap-family read covers: the page's `from`/`to`. */
function requestWindow(context: RequestContext): QueryWindow {
  return resolveQueryWindow(periodQueryOf(context.url));
}

/**
 * The path a heatmap-family route reads, reduced the way the tracker stores
 * it (pathname only, leading slash, no query or fragment) — so a path typed
 * as `demo/pricing` or pasted with its query string finds the page's clicks.
 */
function requestedPath(path: QueryParameter): string {
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
  /** Null for no capture; absent while the site has snapshots off. */
  snapshot?: PageSnapshotSummary | null;
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
   * `sort=clicks` orders by clicks, anything else by views. While the site
   * has snapshots on, each path also says what was captured of it, from one
   * read of the site's captures (documents left out).
   *
   * `workspace` widens a platform owner's dashboard site to another
   * workspace's, or to every workspace's (`all`): each site is read in its
   * own tenant and the counts are added up (see resolveWorkspaceScope).
   */
  @Get("pages")
  // oxlint-disable-next-line eslint/max-params -- The parameter list of a decorated handler is its HTTP surface, not an argument list to shorten.
  async pages(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
    @Parameter("search", "query") search?: string,
    @Parameter("limit", "query") limit?: string,
    @Parameter("sort", "query") sort?: string,
    @Parameter("workspace", "query") workspace?: string,
  ) {
    const { sites } = await requestScope(context, user, website, workspace);
    const captured = sites.filter((site) => site.website.snapshotsEnabled);
    const window = requestWindow(context);
    const [inRange, activity, snapshots] = await Promise.all([
      Promise.all(
        sites.map((site) =>
          GetModel(WebsiteStatisticsModel, site.tenantId).getTopsSince(
            site.website._id,
            window.firstDay,
            PAGES_DIMENSIONS,
            window.lastDay,
          ),
        ),
      ).then((perSite) => perSite.flat()),
      computeScopedPageActivity(siteRefs(sites), window),
      captured.length > 0 ? summarizeScopedSnapshots(siteRefs(captured)) : null,
    ]);

    const views = mergeDimension(inRange, "topPages");
    const paths = new Set([...Object.keys(views), ...activity.clicks.keys()]);
    const needle = queryString(search)?.toLowerCase() ?? "";
    const order: PagesSort =
      queryString(sort) === "clicks" ? "clicks" : "views";
    const matching = [...paths]
      .filter((path) => !needle || path.toLowerCase().includes(needle))
      .map((path): PageRow => {
        const row: PageRow = {
          path,
          pageviews: views[path] ?? 0,
          clicks: activity.clicks.get(path) ?? 0,
          sampled: activity.sampled.get(path) ?? 0,
        };
        if (snapshots) {
          row.snapshot = snapshots.get(path) ?? null;
        }
        return row;
      })
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
      snapshotsEnabled: captured.length > 0,
    };
  }

  /**
   * The workspaces the selector of `website` offers: the DMS core's
   * tenants with a dashboard site, for a platform owner on their own
   * dashboard site; an empty list — no selector — otherwise.
   */
  @Get("workspaces")
  async workspaces(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    return {
      workspaces: await listDashboardWorkspaces(
        scopeStores(),
        viewerOf(context, user),
        await requireTenantWebsite(context, queryString(website)),
      ),
    };
  }

  /** Clicks of one path. With `workspace` (see pages), computed in each
   * workspace and merged. */
  @Get("heatmap")
  async heatmap(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
    @Parameter("path", "query") path?: string,
    @Parameter("workspace", "query") workspace?: string,
  ) {
    const wantedPath = requestedPath(path);
    if (queryString(workspace)) {
      const { sites } = await requestScope(context, user, website, workspace);
      const window = requestWindow(context);
      return mergeClickHeatmaps(
        await Promise.all(
          sites.map((site) =>
            computeClickHeatmap(
              site.tenantId,
              [site.website._id],
              wantedPath,
              window,
            ),
          ),
        ),
      );
    }
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
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
    @Parameter("path", "query") path?: string,
    @Parameter("workspace", "query") workspace?: string,
  ) {
    const wantedPath = requestedPath(path);
    if (queryString(workspace)) {
      const { sites } = await requestScope(context, user, website, workspace);
      const window = requestWindow(context);
      return mergeScrollDepths(
        await Promise.all(
          sites.map((site) =>
            computeScrollDepth(
              site.tenantId,
              [site.website._id],
              wantedPath,
              window,
            ),
          ),
        ),
      );
    }
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
   * Under another `workspace` (see pages) the newest capture of the scope's
   * sites is sent, its text masked here whatever the site's own setting:
   * another workspace's records never reach the browser readable.
   */
  @Get("snapshot")
  // oxlint-disable-next-line eslint/max-params -- The parameter list of a decorated handler is its HTTP surface, not an argument list to shorten.
  async snapshot(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
    @Parameter("path", "query") path?: string,
    @Parameter("layout", "query") layout?: string,
    @Parameter("workspace", "query") workspace?: string,
  ) {
    const wantedPath = requestedPath(path);
    const { sites, foreign } = await requestScope(
      context,
      user,
      website,
      workspace,
    );
    const wantedLayout = queryString(layout);
    return {
      snapshot: await readScopedPageSnapshot(
        siteRefs(sites),
        wantedPath,
        isSnapshotLayout(wantedLayout) ? wantedLayout : DEFAULT_SNAPSHOT_LAYOUT,
        foreign,
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
   * deleted.
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
    return resetHeatmapEvents(websiteDoc.tenantId, websiteDoc._id, path);
  }
}
