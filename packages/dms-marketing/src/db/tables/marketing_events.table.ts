import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";
import type { EventKind } from "@/types";

export const marketingEventsTableName = "marketing_events";

/**
 * Compound index backing every read path: `queryRange` narrows a website set
 * first, then a time window, then sorts on that same window. Equality field
 * before range field, so the sort is served by the index instead of being a
 * blocking in-memory pass. Field order follows declaration order below.
 */
const WEBSITE_TIMESTAMP_INDEX = "websiteId_timestamp";

/**
 * Raw event stream — the source funnels, retention cohorts and heatmaps are
 * computed from. Deliberately thin (no headers, no IP, no user agent:
 * identity is the anonymous visitor hash) and short-lived:
 * `rawEventsRetention` prunes it hourly, dashboards read the daily rollup.
 */
@RegisterTable(marketingEventsTableName, TENANT_SCHEMA_NAME)
export class MarketingEvent extends Table {
  @Index({ group: WEBSITE_TIMESTAMP_INDEX })
  @Field("string")
  declare websiteId: string;

  /** Standalone index as well: `deleteOlderThan` bounds on time alone. */
  @Index({ group: WEBSITE_TIMESTAMP_INDEX })
  @Index()
  @Field("date")
  declare timestamp: Date;

  /** Timestamp at midnight UTC (ms), denormalized for grouping. Not indexed:
   * every query bounds time through `timestamp`, never through this field. */
  @Field("number")
  declare day: number;

  /** Not indexed, like the two fields below: every kind predicate is a
   * residual filter over rows the compound index already narrowed. */
  @Field("string")
  declare kind: EventKind;

  /** Funnel computation groups by session in memory, over rows already
   * narrowed by the compound index — neither field is ever a query filter,
   * so indexing them would only tax the module's heaviest write path. */
  @Field("string")
  declare sessionId: string;

  @Field("string")
  declare visitorId: string;

  /** Path only — query strings are dropped at ingestion so stray PII in URLs
   * never reaches storage (UTM fields are extracted onto the session). */
  @Field("string")
  declare url: string;

  @Field("string")
  declare referrerDomain?: string;

  /** Custom event name, or experiment key for "exposure" events. */
  @Field("string")
  declare name?: string;

  /** Kind-specific payload: ClickEventData | ScrollEventData | ExposureEventData | custom. */
  @Field("any")
  declare data?: Record<string, unknown>;
}
