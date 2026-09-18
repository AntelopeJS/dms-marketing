import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  type TopDimension,
  type TopEntries,
  byDimension,
  type MarketingStatsDelta,
} from "@/types";
import {
  WebsiteStatistics,
  websiteStatisticsTableName,
} from "../tables/website_statistics.table";

/** Primary key of a rollup row; the write path never needs a lookup. */
export function dayRowId(websiteId: string, day: number): string {
  return `${websiteId}:${day}`;
}

/** One day's slice of the top maps, holding only the requested dimensions. */
export type DayTops = Partial<Record<TopDimension, TopEntries>>;

export class WebsiteStatisticsModel extends BasicDataModel(
  WebsiteStatistics,
  websiteStatisticsTableName,
) {
  async getDaysSince(
    websiteId: string,
    cutoff: number,
  ): Promise<WebsiteStatistics[]> {
    return this.table
      .getAll(websiteId, "websiteId")
      .filter((doc) => doc.key("day").ge(cutoff))
      .orderBy("day", "asc")
      .run();
  }

  /**
   * The asked-for top maps alone, one entry per day of the window. A row
   * carries all sixteen dimensions in one `tops` field, and the surfaces that
   * read a single map (/pages) or five (/campaigns) have no reason to carry
   * the others across. Unordered on purpose: the caller merges the maps, and
   * a merge has no first day. Absent maps come back null — a day whose maps
   * the retention pass emptied has nothing under its dimension.
   */
  async getTopsSince(
    websiteId: string,
    cutoff: number,
    dimensions: readonly TopDimension[],
  ): Promise<DayTops[]> {
    return this.table
      .getAll(websiteId, "websiteId")
      .filter((doc) => doc.key("day").ge(cutoff))
      .map((doc) => {
        const tops = doc.key("tops");
        return Object.fromEntries(
          dimensions.map((dimension) => [dimension, tops.key(dimension)]),
        );
      })
      .run() as Promise<DayTops[]>;
  }

  /**
   * Fold one delta into a day row: the scalar counters are server-side
   * increments in a single update, so concurrent batches — parallel
   * instances included — each add their own delta. The top maps are a plain
   * value write (their merge happened in the caller's read step): last write
   * wins there, bounded by the maps' cap-based eviction being approximate by
   * design.
   */
  async addDelta(
    id: string,
    delta: MarketingStatsDelta,
    tops: Record<TopDimension, TopEntries>,
  ): Promise<number> {
    return this.table
      .get(id)
      .update((doc) => ({
        pageviews: doc.key("pageviews").add(delta.pageviews),
        sessions: doc.key("sessions").add(delta.sessions),
        newVisitors: doc.key("newVisitors").add(delta.newVisitors),
        customEvents: doc.key("customEvents").add(delta.customEvents),
        // Defaulted: the server-side add of a missing key yields null, not
        // the increment.
        bouncedSessions: doc
          .key("bouncedSessions")
          .default(0)
          .add(delta.bouncedSessions),
        sessionDurationMs: doc
          .key("sessionDurationMs")
          .default(0)
          .add(delta.sessionDurationMs),
        tops,
      }))
      .run();
  }

  async deleteDaysBefore(cutoff: number): Promise<number> {
    return this.table.between("day", 0, cutoff).delete().run();
  }

  /** The returned count only includes rows whose maps were not empty yet. */
  async emptyTopsBefore(cutoff: number): Promise<number> {
    return this.table
      .between("day", 0, cutoff)
      .update({ tops: byDimension<TopEntries>(() => ({})) })
      .run();
  }

  async deleteByWebsite(websiteId: string): Promise<number> {
    return this.table.getAll(websiteId, "websiteId").delete().run();
  }
}
