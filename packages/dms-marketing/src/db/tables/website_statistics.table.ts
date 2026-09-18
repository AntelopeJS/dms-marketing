import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import type { TopDimension, TopEntries } from "@/types";

export const websiteStatisticsTableName = "marketing_website_statistics";

/**
 * Daily rollup: one row per website and UTC day, addressed by primary key
 * (`_id` = `websiteId:day`) so the scalar counters can be native server-side
 * increments — concurrent collect batches, including on parallel instances,
 * each add their own delta instead of overwriting the row. The top-N maps
 * are the one part that stays a read-merge-write: they carry dynamic keys
 * with cap-based eviction, which no increment can express.
 */
@RegisterTable(websiteStatisticsTableName, TENANT_SCHEMA_NAME)
export class WebsiteStatistics extends Table {
  @Index()
  @Field("string")
  declare websiteId: string;

  /** Timestamp at midnight UTC (ms). Indexed: both retention passes (row
   * deletion, top-map emptying) bound on it alone. */
  @Index()
  @Field("number")
  declare day: number;

  @Field("number")
  declare pageviews: number;

  @Field("number")
  declare sessions: number;

  @Field("number")
  declare newVisitors: number;

  @Field("number")
  declare customEvents: number;

  /** Sessions sitting at exactly one pageview, counted as transitions — see
   * `MarketingDayCounters`. */
  @Field("number")
  declare bouncedSessions?: number;

  @Field("number")
  declare sessionDurationMs?: number;

  /** One map per `TOP_DIMENSIONS` entry, in one field so the dimension list
   * stays declared in a single place. Emptied past `TOP_MAPS_RETENTION_DAYS`
   * by the retention prune; the scalars above keep the full retention. */
  @Field("any")
  declare tops: Record<TopDimension, TopEntries>;
}
