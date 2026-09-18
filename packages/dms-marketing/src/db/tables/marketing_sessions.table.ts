import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const marketingSessionsTableName = "marketing_sessions";

/**
 * Compound index for `findLatestForVisitor` (run on every collect batch that
 * misses the cache): its getAll lands on the `websiteId` prefix, and the
 * residual visitorId filter and sort walk index-narrowed rows. The same
 * prefix serves the per-website group-max. Field order follows declaration
 * order below.
 */
const VISITOR_SESSION_INDEX = "websiteId_visitorId_startedAt";

/**
 * One visit: a run of events from the same visitor with less than the session
 * window between them. Carries the acquisition context (referrer, UTM) and
 * device triple so events stay thin; retention cohorts read this table alone
 * (first-seen week × returning weeks).
 */
@RegisterTable(marketingSessionsTableName, TENANT_SCHEMA_NAME)
export class MarketingSession extends Table {
  @Index({ group: VISITOR_SESSION_INDEX })
  @Field("string")
  declare websiteId: string;

  @Index({ group: VISITOR_SESSION_INDEX })
  @Field("string")
  declare visitorId: string;

  @Index({ group: VISITOR_SESSION_INDEX })
  @Field("date")
  declare startedAt: Date;

  /** Indexed on its own: the hourly retention delete bounds on it alone. */
  @Index()
  @Field("date")
  declare lastSeenAt: Date;

  @Field("boolean")
  declare isNewVisitor: boolean;

  @Field("string")
  declare entryUrl: string;

  @Field("string")
  declare exitUrl: string;

  @Field("number")
  declare pageviewsCount: number;

  @Field("number")
  declare eventsCount: number;

  @Field("string")
  declare referrerDomain?: string;

  @Field("string")
  declare utmSource?: string;

  @Field("string")
  declare utmMedium?: string;

  @Field("string")
  declare utmCampaign?: string;

  @Field("string")
  declare utmTerm?: string;

  @Field("string")
  declare utmContent?: string;

  /**
   * Name of the ad click-id parameter the entry URL carried (gclid, fbclid…),
   * never its value — the value identifies a single click, and the channel
   * mapping only needs to know which platform stamped it. Kept raw so the
   * classification stays revisable without a migration, like the UTM fields.
   */
  @Field("string")
  declare clickIdParam?: string;

  @Field("string")
  declare browser?: string;

  @Field("string")
  declare os?: string;

  @Field("string")
  declare deviceType?: string;

  @Field("string")
  declare screen?: string;

  @Field("string")
  declare language?: string;

  /** ISO 3166-1 alpha-2, derived from the collect IP (never stored) against
   * the operator-supplied GeoIP database; absent when none is configured. */
  @Field("string")
  declare country?: string;
}
