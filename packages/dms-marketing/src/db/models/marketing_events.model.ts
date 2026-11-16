import { ValueProxy } from "@antelopejs/interface-database";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  type EventKind,
  HEATMAP_EVENT_KINDS,
  type ScrollEventData,
} from "@/types";
import {
  HEATMAP_DIVISIONS_PER_AXIS,
  MAX_CLICK_SELECTOR_LENGTH,
  MS_PER_HOUR,
  MS_PER_SECOND,
  SCROLL_DEPTH_SCALE,
} from "@/types/constants";
import { z } from "zod";
import {
  MarketingEvent,
  marketingEventsTableName,
  type NewMarketingEvent,
} from "../tables/marketing_events.table";

const EPOCH_LOWER_BOUND = new Date(0);
const SCROLL_KIND: EventKind = "scroll";
const PAGEVIEW_KIND: EventKind = "pageview";
const CLICK_KIND: EventKind = "click";

type PageviewRow = Pick<MarketingEvent, "timestamp" | "url" | "sessionId">;

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

export type SampleRateQuery = Omit<ScrollDepthQuery, "url">;

/** The clicks of one path over one window, the same read as the scroll histogram. */
export type ClickCellQuery = ScrollDepthQuery;

/** Grid indexes of a normalized point, `HEATMAP_DIVISIONS_PER_AXIS` per axis. */
export interface ClickGridCell {
  gx: number;
  gy: number;
}

/** Clicks of one document-grid cell: those without a usable element anchor. */
export interface DocumentClickCell extends ClickGridCell {
  weight: number;
  /** Epoch seconds of the cell's earliest click. */
  firstAt: number;
}

/** Clicks of one element cell: an anchor's selector, rank and offset grid cell. */
export interface AnchoredClickCell extends ClickGridCell {
  selector: string;
  nth: number;
  weight: number;
  /** The earliest click, whose document point is the cell's fallback. */
  first: { at: number; x: number; y: number };
}

/** Both kinds of click cells of a window, each click in exactly one. */
export interface ClickCells {
  documents: DocumentClickCell[];
  anchored: AnchoredClickCell[];
}

/** A click `data` as stored: every field is checked before it is read. */
interface StoredClickData {
  x: number;
  y: number;
  dx: number;
  dy: number;
  selector: string;
  ox: number;
  oy: number;
  nth: number;
}

/** `$min` over `{ at, x, y }` objects compares `at` first and returns the
 * earliest click whole, but `Stream.min` is typed as a number: the object is
 * parsed back. */
const firstClickSchema = z.object({
  at: z.number(),
  x: z.number(),
  y: z.number(),
});

/**
 * Number in [0, 1]. BSON orders null and missing below numbers and strings,
 * objects, arrays and booleans above them, so the range admits exactly the
 * finite numbers in it: the type guard and the bound are one predicate.
 */
function isFraction(value: ValueProxy<number>): ValueProxy<boolean> {
  return value.ge(0).and(value.le(1));
}

/** Number in [0, Number.MAX_VALUE], by the ordering {@link isFraction} reads. */
function isNonNegative(value: ValueProxy<number>): ValueProxy<boolean> {
  return value.ge(0).and(value.le(Number.MAX_VALUE));
}

/** Strings sort between numbers and objects, and `{}` is the least object. */
function isString(value: ValueProxy<string>): ValueProxy<boolean> {
  return value.ge("").and(value.lt(ValueProxy.constant({}).cast<string>()));
}

/** An absent field sorts below null; a stored null does not. */
function isMissing(value: ValueProxy<number | string>): ValueProxy<boolean> {
  return value.lt(ValueProxy.constant(null).cast<number | string>());
}

/** A field the click may omit, and must otherwise pass `check`. */
function isOptional<T extends number | string>(
  value: ValueProxy<T>,
  check: (value: ValueProxy<T>) => ValueProxy<boolean>,
): ValueProxy<boolean> {
  return isMissing(value.cast<number | string>()).or(check(value));
}

/**
 * The types and bounds `clickDataSchema` sets, from comparisons alone: the
 * planner evaluates a filter on every row, whatever `$and` already rejected,
 * so a filter that throws on one row aborts the read.
 */
function hasClickTypes(data: ValueProxy<StoredClickData>): ValueProxy<boolean> {
  return isFraction(data.key("x"))
    .and(isFraction(data.key("y")))
    .and(isOptional(data.key("dx"), isFraction))
    .and(isOptional(data.key("dy"), isFraction))
    .and(isOptional(data.key("ox"), isFraction))
    .and(isOptional(data.key("oy"), isFraction))
    .and(isOptional(data.key("nth"), isNonNegative))
    .and(isOptional(data.key("selector"), isString));
}

/**
 * The rest of `clickDataSchema`, which needs `$strLenCP` and `$floor`: both
 * throw on a value of another type, so they run in a projection, on the rows
 * {@link hasClickTypes} let through.
 */
function hasClickBounds(
  data: ValueProxy<StoredClickData>,
): ValueProxy<boolean> {
  const nth = data.key("nth").default(0);
  return data
    .key("selector")
    .default("")
    .strlen()
    .le(MAX_CLICK_SELECTOR_LENGTH)
    .and(nth.floor().eq(nth));
}

/** A click that names its element and its offset in it; a click with an
 * empty selector, or without an offset, falls to the document grid. */
function isAnchored(data: ValueProxy<StoredClickData>): ValueProxy<boolean> {
  return data
    .key("selector")
    .gt("")
    .and(data.key("ox").ge(0))
    .and(data.key("oy").ge(0));
}

/** Normalized coordinate → grid index, rounding half up as `Math.round`
 * does: `$round` rounds half to even. */
function gridIndex(normalized: ValueProxy<number>): ValueProxy<number> {
  return normalized.mul(HEATMAP_DIVISIONS_PER_AXIS).add(0.5).floor();
}

/** The click's document point: page coordinates win over viewport ones. */
function documentPoint(data: ValueProxy<StoredClickData>) {
  return {
    x: data.key("dx", data.key("x")),
    y: data.key("dy", data.key("y")),
  };
}

/** One kind over one window, cut in hours from `since`. */
export interface HourlyCountQuery {
  websiteIds: string[];
  since: Date;
  until: Date;
  kind: EventKind;
  /** Count each session once, in the hour of its first event of the window. */
  perSession: boolean;
}

export interface HourlyCountBucket {
  /** Whole hours since `since`. */
  hour: number;
  count: number;
}

/** Pageviews that declared one heatmap sampling rate. */
export interface SampleRateBucket {
  sample: number;
  views: number;
}

export class MarketingEventsModel extends BasicDataModel(
  MarketingEvent,
  marketingEventsTableName,
) {
  /**
   * Events of the websites inside the window, of the asked URL and kinds when
   * given, sorted by timestamp and cut at `limit`, each with its `timestamp`
   * and the asked fields.
   *
   * The websites are read through `getAll`, AQL's indexed lookup: the same
   * disjunction through `filter()` compiles to an expression no index can
   * serve. The projection comes after the sort, never before: sorting is not
   * stable, and rows sharing a timestamp (one collect batch stamps its whole
   * event list with the same instant) come back in whatever order the plan
   * produces. Narrowing the documents first changes that plan, and the funnel
   * walk reads the sequence, so its counts would move with it.
   */
  async queryRange<F extends keyof MarketingEvent>(
    query: EventRangeQuery<F>,
  ): Promise<Pick<MarketingEvent, F | "timestamp">[]> {
    if (query.websiteIds.length === 0) {
      return [];
    }
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
    return q
      .orderBy("timestamp", "asc")
      .slice(0, query.limit)
      .pluck<"timestamp" | F>("timestamp", ...query.fields)
      .run();
  }

  /**
   * Scroll-depth histogram, counted where the rows live: one row per reached
   * depth comes back instead of every scroll event of the window.
   *
   * The range predicate is also the type guard, and it has to be. `data` is
   * stored as an untyped field and the collect schema only constrains it for
   * rows written today, so `depth` can hold anything an older row carries, and
   * $round on a string aborts the WHOLE aggregation. BSON orders numbers below strings,
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
   * Click cells of one path, counted where the rows live: one row per cell
   * comes back, whatever the number of clicks. The query layer has no
   * conditional, so the anchored and the document cells are two reads over
   * complementary filters.
   */
  async countClickCells(query: ClickCellQuery): Promise<ClickCells> {
    if (query.websiteIds.length === 0) {
      return { documents: [], anchored: [] };
    }
    const clicks = () =>
      this.table
        .getAll(query.websiteIds, "websiteId")
        .filter((doc) => doc.key("timestamp").ge(query.since))
        .filter((doc) => doc.key("timestamp").le(query.until))
        .filter((doc) => doc.key("url").eq(query.url))
        .filter((doc) => doc.key("kind").eq(CLICK_KIND))
        .filter((doc) => hasClickTypes(doc.key("data").cast<StoredClickData>()))
        .map((doc) => {
          const data = doc.key("data").cast<StoredClickData>();
          return {
            at: doc.key("timestamp").epoch(),
            data,
            fits: hasClickBounds(data),
          };
        })
        .filter((click) => click.key("fits"));
    const [documents, anchored] = await Promise.all([
      clicks()
        .filter((click) => isAnchored(click.key("data")).not())
        .map((click) => {
          const point = documentPoint(click.key("data"));
          return {
            cell: { gx: gridIndex(point.x), gy: gridIndex(point.y) },
            at: click.key("at"),
          };
        })
        .group("cell", (stream, cell) => ({
          cell,
          weight: stream.count(),
          firstAt: stream.min("at"),
        }))
        .run(),
      clicks()
        .filter((click) => isAnchored(click.key("data")))
        .map((click) => {
          const data = click.key("data");
          return {
            cell: {
              selector: data.key("selector"),
              nth: data.key("nth").default(0),
              gx: gridIndex(data.key("ox")),
              gy: gridIndex(data.key("oy")),
            },
            first: { at: click.key("at"), ...documentPoint(data) },
          };
        })
        .group("cell", (stream, cell) => ({
          cell,
          weight: stream.count(),
          first: stream.min("first"),
        }))
        .run(),
    ]);
    return {
      documents: documents.map(({ cell, weight, firstAt }) => ({
        ...cell,
        weight,
        firstAt,
      })),
      anchored: anchored.map(({ cell, weight, first }) => ({
        ...cell,
        weight,
        first: firstClickSchema.parse(first),
      })),
    };
  }

  /**
   * Pageviews of the window by the sampling rate their tracker declared, one
   * row per rate. Same range guard as the depths: only numbers in [0, 1]
   * pass, and pageviews stored before trackers declared one are left out.
   */
  async countDeclaredSampleRates(
    query: SampleRateQuery,
  ): Promise<SampleRateBucket[]> {
    if (query.websiteIds.length === 0) {
      return [];
    }
    return this.table
      .getAll(query.websiteIds, "websiteId")
      .filter((doc) => doc.key("timestamp").ge(query.since))
      .filter((doc) => doc.key("timestamp").le(query.until))
      .filter((doc) => doc.key("kind").eq(PAGEVIEW_KIND))
      .filter((doc) => {
        const sample = doc.key("data").cast<{ sample: number }>().key("sample");
        return sample.ge(0).and(sample.le(1));
      })
      .map((doc) => ({
        sample: doc.key("data").cast<{ sample: number }>().key("sample"),
      }))
      .group("sample", (stream, sample) => ({
        sample,
        views: stream.count(),
      }))
      .run();
  }

  /**
   * Events of one kind per hour of the window, counted where the rows live:
   * one row per hour that saw any comes back, whatever the traffic. A
   * session-wise count first folds each session to its earliest hour.
   *
   * The hour is computed from the epoch brought back to whole milliseconds
   * before dividing: epochs in seconds carry float noise that would floor an
   * event on the hour into the previous one.
   */
  async countHourly(query: HourlyCountQuery): Promise<HourlyCountBucket[]> {
    if (query.websiteIds.length === 0) {
      return [];
    }
    const sinceSeconds = query.since.getTime() / MS_PER_SECOND;
    const hours = this.table
      .getAll(query.websiteIds, "websiteId")
      .filter((doc) => doc.key("timestamp").ge(query.since))
      .filter((doc) => doc.key("timestamp").le(query.until))
      .filter((doc) => doc.key("kind").eq(query.kind))
      .map((doc) => ({
        sessionId: doc.key("sessionId"),
        hour: doc
          .key("timestamp")
          .epoch()
          .sub(sinceSeconds)
          .mul(MS_PER_SECOND)
          .round()
          .div(MS_PER_HOUR)
          .floor(),
      }));
    const counted = query.perSession
      ? hours.group("sessionId", (stream) => ({ hour: stream.min("hour") }))
      : hours;
    return counted
      .group("hour", (stream, hour) => ({ hour, count: stream.count() }))
      .run();
  }

  /**
   * Documents are built server-side from an already zod-validated payload,
   * so skipping the per-document wrapper validation is safe.
   */
  async insertMany(events: NewMarketingEvent[]): Promise<number> {
    if (events.length === 0) {
      return 0;
    }
    const ids = await this.table.insert(events).run();
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
    return this.heatmapEvents(websiteId, url).delete().run();
  }

  /** What {@link deleteHeatmapEvents} would delete, for its confirmation. */
  async countHeatmapEvents(websiteId: string, url?: string): Promise<number> {
    return this.heatmapEvents(websiteId, url).count().run();
  }

  /** The rows a heatmap reset covers: one query, so count and delete agree. */
  private heatmapEvents(websiteId: string, url?: string) {
    const events = this.table
      .getAll([websiteId], "websiteId")
      .filter((doc) =>
        ValueProxy.constant(HEATMAP_EVENT_KINDS).includes(doc.key("kind")),
      );
    return url ? events.filter((doc) => doc.key("url").eq(url)) : events;
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

  /** Every event an import wrote. Only read to resume a stopped import. */
  async listImported(
    websiteId: string,
    importId: string,
  ): Promise<MarketingEvent[]> {
    return this.table
      .getAll([websiteId], "websiteId")
      .filter((doc) => doc.key("importId").eq(importId))
      .run();
  }

  /** The events of one session, oldest first: what its counters derive from. */
  async listBySession(
    websiteId: string,
    sessionId: string,
  ): Promise<MarketingEvent[]> {
    return this.table
      .getAll([websiteId], "websiteId")
      .filter((doc) => doc.key("sessionId").eq(sessionId))
      .orderBy("timestamp", "asc")
      .run();
  }

  async deleteImportedOnDay(
    websiteId: string,
    importId: string,
    day: number,
  ): Promise<number> {
    return this.table
      .getAll([websiteId], "websiteId")
      .filter((doc) => doc.key("importId").eq(importId))
      .filter((doc) => doc.key("day").eq(day))
      .delete()
      .run();
  }

  /** The install check: the newest pageview stored at or after `since`. */
  async getLatestPageview(
    websiteId: string,
    since: Date,
  ): Promise<PageviewRow | undefined> {
    const rows = await this.table
      .getAll([websiteId], "websiteId")
      .filter((doc) => doc.key("timestamp").ge(since))
      .filter((doc) => doc.key("kind").eq(PAGEVIEW_KIND))
      .orderBy("timestamp", "desc")
      .slice(0, 1)
      .pluck("timestamp", "url", "sessionId")
      .run();
    return rows[0];
  }
}
