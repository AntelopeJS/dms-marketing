import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  MarketingHeatmapAnchor,
  MarketingHeatmapPayload,
  MarketingHeatmapPoint,
  MarketingHeatmapQuery,
} from "@antelopejs/interface-dms-marketing";
import {
  MarketingEventsModel,
  PageSnapshotsModel,
  type ScrollDepthBucket,
  WebsitesModel,
} from "@/db";
import type { MarketingEvent } from "@/db/tables/marketing_events.table";
import type { ClickEventData, EventKind } from "@/types";
import {
  HEATMAP_DIVISIONS_PER_AXIS,
  MAX_ANCHORED_HEATMAP_CELLS,
  MAX_HEATMAP_EVENTS,
  SCROLL_DEPTH_SCALE,
} from "@/types/constants";
import { type QueryWindow, resolveQueryWindow } from "./period";
import { deleteSnapshots } from "./snapshots";

const CLICK_FIELDS = ["data"] as const;

/**
 * Pageviews under which a measured sampling share is noise: 1 sampled view
 * out of 3 says nothing about the rate the snippet applies.
 */
const MIN_PAGEVIEWS_FOR_SAMPLE_RATE = 20;

const EMPTY_HEATMAP: MarketingHeatmapPayload = {
  points: [],
  maxWeight: 0,
  totalClicks: 0,
  truncated: false,
};

/**
 * Scroll-depth distribution of one path. Every sampled view reports one
 * depth, scrolled or not (0 for a long page left unscrolled, 100 for one
 * that fits its screen), so `views` is also the number of sampled views.
 * Events stored before the tracker did so only cover views that scrolled.
 */
export interface MarketingScrollDepthPayload {
  views: number;
  /** reached[d] = views whose max depth is ≥ d percent, d = 0..100. */
  reached: number[];
  /**
   * Kept in the payload for the consumers that read it, always false: the
   * distribution is counted in the database over the whole window, so there
   * is no event cap left to bust.
   */
  truncated: boolean;
}

const EMPTY_SCROLL_DEPTH: MarketingScrollDepthPayload = {
  views: 0,
  reached: [],
  truncated: false,
};

/** Normalized coordinate → grid index, the last division absorbing 1.0. */
function toGridIndex(normalized: number): number {
  return Math.min(
    Math.round(normalized * HEATMAP_DIVISIONS_PER_AXIS),
    HEATMAP_DIVISIONS_PER_AXIS,
  );
}

/** Grid index → normalized coordinate of its division. */
function toFraction(index: number): number {
  return index / HEATMAP_DIVISIONS_PER_AXIS;
}

/** Add weight to the document-grid cell containing the normalized point. */
function addToDocumentCell(
  cells: Map<string, MarketingHeatmapPoint>,
  x: number,
  y: number,
  weight: number,
): void {
  const gx = toGridIndex(x);
  const gy = toGridIndex(y);
  const key = `d:${gx}:${gy}`;
  const cell = cells.get(key) ?? {
    x: toFraction(gx),
    y: toFraction(gy),
    weight: 0,
  };
  cell.weight += weight;
  cells.set(key, cell);
}

/** Element anchor of a click, when the tracker recorded one. */
function anchorOf(data: ClickEventData): MarketingHeatmapAnchor | null {
  if (!data.selector) {
    return null;
  }
  if (typeof data.ox !== "number" || typeof data.oy !== "number") {
    return null;
  }
  return {
    selector: data.selector,
    ox: data.ox,
    oy: data.oy,
    nth: data.nth ?? 0,
  };
}

/**
 * Re-bucket the least-weighted anchored cells into the document grid once
 * they outnumber MAX_ANCHORED_HEATMAP_CELLS: clicks past the cap lose their
 * anchor, never their count.
 */
function capAnchoredCells(cells: Map<string, MarketingHeatmapPoint>): void {
  const anchored: Array<{ key: string; cell: MarketingHeatmapPoint }> = [];
  for (const [key, cell] of cells) {
    if (cell.anchor) {
      anchored.push({ key, cell });
    }
  }
  if (anchored.length <= MAX_ANCHORED_HEATMAP_CELLS) {
    return;
  }
  anchored.sort((a, b) => b.cell.weight - a.cell.weight);
  for (const { key, cell } of anchored.slice(MAX_ANCHORED_HEATMAP_CELLS)) {
    cells.delete(key);
    addToDocumentCell(cells, cell.x, cell.y, cell.weight);
  }
}

/**
 * Add a click to the cell of its anchored element, so one element stays one
 * cell whatever window it was clicked through. The first click fixes the
 * cell's document-fraction fallback (x/y) for consumers that cannot resolve
 * the selector.
 */
function addToAnchoredCell(
  cells: Map<string, MarketingHeatmapPoint>,
  anchor: MarketingHeatmapAnchor,
  x: number,
  y: number,
): void {
  const gx = toGridIndex(anchor.ox);
  const gy = toGridIndex(anchor.oy);
  const key = `a:${anchor.selector}:${anchor.nth}:${gx}:${gy}`;
  const cell = cells.get(key) ?? {
    x,
    y,
    weight: 0,
    anchor: { ...anchor, ox: toFraction(gx), oy: toFraction(gy) },
  };
  cell.weight++;
  cells.set(key, cell);
}

/**
 * Bucket one click — per element when anchored, per document cell otherwise,
 * never mixed. False when the click carries no usable coordinates (dx/dy
 * winning over viewport x/y).
 */
function bucketClick(
  cells: Map<string, MarketingHeatmapPoint>,
  data: ClickEventData,
): boolean {
  const x = data.dx ?? data.x;
  const y = data.dy ?? data.y;
  if (typeof x !== "number" || typeof y !== "number") {
    return false;
  }
  const anchor = anchorOf(data);
  if (anchor) {
    addToAnchoredCell(cells, anchor, x, y);
  } else {
    addToDocumentCell(cells, x, y, 1);
  }
  return true;
}

/** Fold click payloads into heatmap cells and totals. */
function bucketClicks(
  payloads: ClickPayload[],
): Omit<MarketingHeatmapPayload, "truncated"> {
  const cells = new Map<string, MarketingHeatmapPoint>();
  let totalClicks = 0;
  for (const payload of payloads) {
    const data = payload.data as ClickEventData | undefined;
    if (data && bucketClick(cells, data)) {
      totalClicks++;
    }
  }
  // maxWeight only after the cap: re-bucketing merges weights into document cells.
  capAnchoredCells(cells);
  const points = [...cells.values()];
  return {
    points,
    maxWeight: points.reduce((top, point) => Math.max(top, point.weight), 0),
    totalClicks,
  };
}

/**
 * All a click contributes to the map. Unlike the scroll histogram, the
 * bucketing stays here: a click lands either in its element's cell or in a
 * document cell depending on whether the payload carries a usable anchor, and
 * the anchored cells are capped by re-bucketing the lightest ones — a branch
 * and a second pass the query layer cannot express (no conditional in the
 * ValueProxy, and `data` is an unvalidated record, so an arithmetic stage over
 * it would abort the aggregation on the first forged payload). What the
 * projection does buy is that only `data` travels, never the whole row.
 */
type ClickPayload = Pick<MarketingEvent, "data">;

/** Click heatmap of one path over an explicit, already-authorized website set. */
export async function computeClickHeatmap(
  tenantId: string,
  websiteIds: string[],
  path: string,
  window: QueryWindow,
): Promise<MarketingHeatmapPayload> {
  if (websiteIds.length === 0) {
    return EMPTY_HEATMAP;
  }
  const events = await GetModel(MarketingEventsModel, tenantId).queryRange({
    websiteIds,
    since: window.since,
    until: window.until,
    kinds: ["click"],
    url: path,
    limit: MAX_HEATMAP_EVENTS,
    fields: CLICK_FIELDS,
  });
  return {
    ...bucketClicks(events),
    truncated: events.length >= MAX_HEATMAP_EVENTS,
  };
}

/**
 * Per-depth counts → the cumulative reached-at-depth curve. Reading the
 * buckets backwards turns "views whose max depth is exactly d" into "views
 * whose max depth is at least d" in one pass.
 */
function cumulativeReach(
  buckets: ScrollDepthBucket[],
): Omit<MarketingScrollDepthPayload, "truncated"> {
  const counts = Array.from<number>({ length: SCROLL_DEPTH_SCALE + 1 }).fill(0);
  let views = 0;
  for (const bucket of buckets) {
    counts[bucket.depth] += bucket.views;
    views += bucket.views;
  }
  const reached = Array.from<number>({ length: SCROLL_DEPTH_SCALE + 1 }).fill(
    0,
  );
  let running = 0;
  for (let depth = SCROLL_DEPTH_SCALE; depth >= 0; depth--) {
    running += counts[depth];
    reached[depth] = running;
  }
  return { views, reached };
}

/**
 * Scroll-depth read of one path — same scope and window as the clicks, but
 * counted in the database: what comes back is one row per reached depth
 * (101 at most), never the underlying events.
 */
export async function computeScrollDepth(
  tenantId: string,
  websiteIds: string[],
  path: string,
  window: QueryWindow,
): Promise<MarketingScrollDepthPayload> {
  if (websiteIds.length === 0) {
    return EMPTY_SCROLL_DEPTH;
  }
  const buckets = await GetModel(
    MarketingEventsModel,
    tenantId,
  ).countScrollDepths({
    websiteIds,
    since: window.since,
    until: window.until,
    url: path,
  });
  return { ...cumulativeReach(buckets), truncated: false };
}

/** Per-path heatmap activity of one site over a window, for the inventory. */
export interface PageActivity {
  clicks: Map<string, number>;
  /** Sampled views per path: each one reports exactly one scroll depth. */
  sampled: Map<string, number>;
  /**
   * Share of the window's page loads that were sampled: the rate the tracker
   * declared on its pageviews (`data-heatmap-sample` overrides the module
   * setting), averaged. Null while too few pageviews declare one — those
   * stored before trackers did say nothing.
   */
  sampleRate: number | null;
}

/** Events of one kind per path, counted where the rows live. */
async function countByPath(
  tenantId: string,
  websiteId: string,
  window: QueryWindow,
  kind: EventKind,
): Promise<Map<string, number>> {
  const rows = (await GetModel(MarketingEventsModel, tenantId)
    .table.getAll([websiteId], "websiteId")
    .filter((doc) => doc.key("timestamp").ge(window.since))
    .filter((doc) => doc.key("timestamp").le(window.until))
    .filter((doc) => doc.key("kind").eq(kind))
    .group("url", (stream, url) => ({ url, count: stream.count() }))
    .run()) as Array<{ url: string; count: number }>;
  return new Map(rows.map((row) => [row.url, row.count]));
}

export async function computePageActivity(
  tenantId: string,
  websiteId: string,
  window: QueryWindow,
): Promise<PageActivity> {
  const [clicks, sampled, declared] = await Promise.all([
    countByPath(tenantId, websiteId, window, "click"),
    countByPath(tenantId, websiteId, window, "scroll"),
    GetModel(MarketingEventsModel, tenantId).countDeclaredSampleRates({
      websiteIds: [websiteId],
      since: window.since,
      until: window.until,
    }),
  ]);
  let pageviews = 0;
  let sampledShare = 0;
  for (const { sample, views } of declared) {
    pageviews += views;
    sampledShare += sample * views;
  }
  return {
    clicks,
    sampled,
    sampleRate:
      pageviews >= MIN_PAGEVIEWS_FOR_SAMPLE_RATE
        ? sampledShare / pageviews
        : null,
  };
}

/** What a heatmap reset deletes: one path when given, the whole site otherwise. */
export interface HeatmapData {
  events: number;
  snapshots: number;
}

/**
 * The figures the reset dialogs confirm with — the same rows
 * {@link resetHeatmap} deletes, every period.
 */
export async function countHeatmapData(
  tenantId: string,
  websiteId: string,
  path?: string,
): Promise<HeatmapData> {
  const [events, snapshots] = await Promise.all([
    GetModel(MarketingEventsModel, tenantId).countHeatmapEvents(
      websiteId,
      path,
    ),
    GetModel(PageSnapshotsModel, tenantId).countByWebsite(websiteId, path),
  ]);
  return { events, snapshots };
}

/**
 * A heatmap has no storage of its own — resetting one deletes the click and
 * scroll events it is computed from, and the page snapshots drawn under
 * them: a reset says the page changed. One path when given, the whole site
 * otherwise; returns what died.
 */
export async function resetHeatmap(
  tenantId: string,
  websiteId: string,
  path?: string,
): Promise<HeatmapData> {
  const snapshots = await deleteSnapshots(tenantId, websiteId, path);
  const events = await GetModel(
    MarketingEventsModel,
    tenantId,
  ).deleteHeatmapEvents(websiteId, path);
  return { events, snapshots };
}

/**
 * Website scope of an interface-facing read: one site when asked for, else
 * every site of the tenant. A foreign or unknown id resolves to the empty set
 * — the caller gets an empty heatmap, not an authorization error.
 */
async function tenantHeatmapScope(
  tenantId: string,
  websiteId?: string,
): Promise<string[]> {
  const websites = GetModel(WebsitesModel);
  if (!websiteId) {
    return websites.listIdsByTenant(tenantId);
  }
  const site = await websites.get(websiteId);
  return site?.tenantId === tenantId ? [site._id] : [];
}

/**
 * Interface-facing entry (implements GetClickHeatmap): resolves the tenant's
 * websites itself, so a foreign or unknown website id yields an empty heatmap
 * instead of an authorization error — interface callers have no HTTP context.
 */
export async function buildTenantHeatmap(
  query: MarketingHeatmapQuery,
): Promise<MarketingHeatmapPayload> {
  const websiteIds = await tenantHeatmapScope(query.tenantId, query.websiteId);
  return computeClickHeatmap(
    query.tenantId,
    websiteIds,
    query.path,
    resolveQueryWindow({ from: query.from, to: query.to }),
  );
}
