import { InterfaceFunction } from "@antelopejs/interface-core";

/**
 * Where a click landed inside the element it hit — the anchor an overlay
 * should project from when it can resolve `selector` against the rendered
 * page. `ox`/`oy` are offsets within that element's box, 0-1.
 *
 * This exists because `x`/`y` are not a property of the page alone: they
 * divide by the document box, which on a page shorter than the visitor's
 * window IS the window, so the same element yields a different fraction on
 * every window size. The anchor is stable across window sizes; `x`/`y`
 * remain for consumers that cannot resolve a selector.
 */
export interface MarketingHeatmapAnchor {
  /** Short CSS selector of the clicked element, as the tracker recorded it. */
  selector: string;
  ox: number;
  oy: number;
  /** Index among the elements matching `selector`, for ambiguous selectors. */
  nth: number;
}

/** One aggregated cell of a click heatmap; coordinates are normalised 0-1. */
export interface MarketingHeatmapPoint {
  x: number;
  y: number;
  weight: number;
  /**
   * Absent on clicks captured before element anchoring, and on those whose
   * target was the document itself (a box that is the window, not the page).
   * Consumers that cannot resolve it fall back to `x`/`y`.
   */
  anchor?: MarketingHeatmapAnchor;
}

/** Aggregated click heatmap for one page path. */
export interface MarketingHeatmapPayload {
  points: MarketingHeatmapPoint[];
  maxWeight: number;
  totalClicks: number;
  /** True when the window hit the implementer's event cap and older clicks were cut. */
  truncated: boolean;
}

/** Query for {@link GetClickHeatmap}. */
export interface MarketingHeatmapQuery {
  /** Tenant whose websites are read — pass an authenticated tenant id only. */
  tenantId: string;
  /** Page path exactly as tracked (e.g. "/pricing"). */
  path: string;
  /**
   * Look-back window in the "<days>d" wire format of the marketing HTTP
   * surface (e.g. "7d"); the implementer parses, defaults and caps it.
   */
  period?: string;
  /** Restrict to one website of the tenant; defaults to all of them. */
  websiteId?: string;
}

/**
 * Click heatmap of one page path across the tenant's websites, aggregated on
 * the implementer's grid. As an optional-dependency interface the call
 * rejects when no module implements it — callers must catch and degrade.
 */
export const GetClickHeatmap =
  InterfaceFunction<
    (query: MarketingHeatmapQuery) => Promise<MarketingHeatmapPayload>
  >();
