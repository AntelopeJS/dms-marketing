import { type Table, ValueProxy } from "@antelopejs/interface-database";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  type EventKind,
  HEATMAP_EVENT_KINDS,
  type ScrollEventData,
} from "@/types";
import {
  MS_PER_HOUR,
  MS_PER_SECOND,
  SCROLL_DEPTH_SCALE,
} from "@/types/constants";
import {
  MarketingEvent,
  marketingEventsTableName,
  type NewMarketingEvent,
} from "../tables/marketing_events.table";

/** Input type of Table.insert; DeepPartial itself is not exported. */
type EventInsertInput = Parameters<Table<MarketingEvent>["insert"]>[0];

const EPOCH_LOWER_BOUND = new Date(0);
const SCROLL_KIND: EventKind = "scroll";
const PAGEVIEW_KIND: EventKind = "pageview";

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
    const rows = events as EventInsertInput;
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

  /** The install check: the newest pageview stored at or after `since`. */
  async getLatestPageview(
    websiteId: string,
    since: Date,
  ): Promise<PageviewRow | undefined> {
    const rows = (await this.table
      .getAll([websiteId], "websiteId")
      .filter((doc) => doc.key("timestamp").ge(since))
      .filter((doc) => doc.key("kind").eq(PAGEVIEW_KIND))
      .orderBy("timestamp", "desc")
      .slice(0, 1)
      .pluck("timestamp", "url", "sessionId")
      .run()) as PageviewRow[];
    return rows[0];
  }
}
