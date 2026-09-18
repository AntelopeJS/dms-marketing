import { type Table, ValueProxy } from "@antelopejs/interface-database";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  type EventKind,
  HEATMAP_EVENT_KINDS,
  type ScrollEventData,
} from "@/types";
import { SCROLL_DEPTH_SCALE } from "@/types/constants";
import {
  MarketingEvent,
  marketingEventsTableName,
} from "../tables/marketing_events.table";

/** Input type of Table.insert; DeepPartial itself is not exported. */
type EventInsertInput = Parameters<Table<MarketingEvent>["insert"]>[0];

const EPOCH_LOWER_BOUND = new Date(0);
const SCROLL_KIND: EventKind = "scroll";

export interface EventRangeQuery<F extends keyof MarketingEvent> {
  websiteIds: string[];
  since: Date;
  until: Date;
  kinds?: EventKind[];
  url?: string;
  limit: number;
  /**
   * What the caller actually reads. Mandatory rather than optional: a read
   * path that does not say drags `data` — up to MAX_EVENT_DATA_BYTES per row,
   * on windows capped at hundreds of thousands of rows — across the wire for
   * nothing. `timestamp` rides along whatever is asked: the read is ordered
   * on it.
   */
  fields: readonly F[];
}

/** One path over one window — the scroll histogram needs no other axis. */
export interface ScrollDepthQuery {
  websiteIds: string[];
  since: Date;
  until: Date;
  url: string;
}

export interface ScrollDepthBucket {
  depth: number;
  views: number;
}

export class MarketingEventsModel extends BasicDataModel(
  MarketingEvent,
  marketingEventsTableName,
) {
  async queryRange<F extends keyof MarketingEvent>(
    query: EventRangeQuery<F>,
  ): Promise<Pick<MarketingEvent, F | "timestamp">[]> {
    if (query.websiteIds.length === 0) {
      return [];
    }
    // getAll is AQL's indexed lookup; the same disjunction through filter()
    // compiles to an expression no index can serve.
    let q = this.table
      .getAll(query.websiteIds, "websiteId")
      .filter((doc) => doc.key("timestamp").ge(query.since))
      .filter((doc) => doc.key("timestamp").le(query.until));
    const url = query.url;
    if (url) {
      q = q.filter((doc) => doc.key("url").eq(url));
    }
    const kinds = query.kinds;
    if (kinds && kinds.length > 0) {
      q = q.filter((doc) =>
        ValueProxy.constant(kinds).includes(doc.key("kind")),
      );
    }
    // Project AFTER the sort, never before. Sorting is not stable and rows
    // sharing a timestamp — routine here, one collect batch stamps its whole
    // event list with the same instant — come back in whatever order the plan
    // produces. Narrowing the documents first changes that plan, and the
    // funnel walk reads the sequence, so the counts would move with it.
    return q
      .orderBy("timestamp", "asc")
      .slice(0, query.limit)
      .pluck("timestamp", ...query.fields)
      .run() as Promise<Pick<MarketingEvent, F | "timestamp">[]>;
  }

  /**
   * Scroll-depth histogram, counted where the rows live: one row per reached
   * depth comes back instead of every scroll event of the window.
   *
   * The range predicate is also the type guard, and it has to be. `data` is
   * stored as an open record — the collect schema types it `z.record(unknown)`
   * — so `depth` can hold anything a forged beacon puts there, and $round on a
   * string aborts the WHOLE aggregation. BSON orders numbers below strings,
   * objects and booleans and above null, so bounding on [0, SCROLL_DEPTH_SCALE]
   * admits exactly the finite numbers in range. Out-of-range depths are
   * dropped rather than clamped: no honest tracker emits them.
   */
  async countScrollDepths(
    query: ScrollDepthQuery,
  ): Promise<ScrollDepthBucket[]> {
    if (query.websiteIds.length === 0) {
      return [];
    }
    return this.table
      .getAll(query.websiteIds, "websiteId")
      .filter((doc) => doc.key("timestamp").ge(query.since))
      .filter((doc) => doc.key("timestamp").le(query.until))
      .filter((doc) => doc.key("url").eq(query.url))
      .filter((doc) => doc.key("kind").eq(SCROLL_KIND))
      .filter((doc) => {
        const depth = doc.key("data").cast<ScrollEventData>().key("depth");
        return depth.ge(0).and(depth.le(SCROLL_DEPTH_SCALE));
      })
      .map((doc) => ({
        depth: doc.key("data").cast<ScrollEventData>().key("depth").round(),
      }))
      .group("depth", (stream, depth) => ({
        depth,
        views: stream.count(),
      }))
      .run();
  }

  /**
   * Documents are built server-side from an already zod-validated payload,
   * so skipping the per-document wrapper validation is safe.
   */
  async insertMany(events: MarketingEvent[]): Promise<number> {
    if (events.length === 0) {
      return 0;
    }
    // DeepPartial cannot traverse `data: Record<string, unknown>`; these are
    // full rows, not partials, so widening through unknown is sound.
    // DeepPartial cannot traverse the free-form `data` record; see above.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions
    const rows = events as unknown as EventInsertInput;
    const ids = await this.table.insert(rows).run();
    return ids.length;
  }

  /**
   * Heatmap reset: clicks and scroll depths are the only kinds the heatmap
   * surface reads, and deleting them touches nothing else — funnels read
   * pageview/custom, rollups are written at ingestion. No time bound on
   * purpose: a reset discards the page's whole capture history, not the
   * window being looked at.
   */
  async deleteHeatmapEvents(websiteId: string, url?: string): Promise<number> {
    let q = this.table
      .getAll([websiteId], "websiteId")
      .filter((doc) =>
        ValueProxy.constant(HEATMAP_EVENT_KINDS).includes(doc.key("kind")),
      );
    if (url) {
      q = q.filter((doc) => doc.key("url").eq(url));
    }
    return q.delete().run();
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    return this.table
      .between("timestamp", EPOCH_LOWER_BOUND, cutoff)
      .delete()
      .run();
  }

  async deleteByWebsite(websiteId: string): Promise<number> {
    return this.table.getAll([websiteId], "websiteId").delete().run();
  }
}
