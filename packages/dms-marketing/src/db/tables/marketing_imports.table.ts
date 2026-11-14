import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const marketingImportsTableName = "marketing_imports";

export type ImportStatus = "running" | "done" | "failed";

/**
 * One analytics import (`ImportAnalytics`) applied to a website, keyed by
 * website and import id: the row is claimed before the first event is
 * written, and a completed import id is never replayed, even across instances.
 * An import that stopped part-way is resumed by the next call with its id, from
 * the days the rollup ledger does not name (`WebsiteStatistics.appliedImports`).
 */
@RegisterTable(marketingImportsTableName, TENANT_SCHEMA_NAME)
export class MarketingImport extends Table {
  @Index()
  @Field("string")
  declare websiteId: string;

  @Field("string")
  declare importId: string;

  @Field("string")
  declare status: ImportStatus;

  @Field("number")
  declare sessions: number;

  @Field("number")
  declare events: number;

  @Field("number")
  declare dropped: number;

  @Field("date")
  declare startedAt: Date;

  @Field("date")
  declare finishedAt?: Date;

  /** Latest eligible event of a completed import; epoch for an empty one. */
  @Field("date")
  declare importedThrough?: Date;

  /**
   * Only the reserved per-website mutex row carries this token. Its holder
   * replaces it while the replay runs, so a holder that stopped is one whose
   * token stopped changing.
   */
  @Field("string")
  declare claimToken?: string;

  /**
   * Only an import row carries this value. Each write to the row replaces it,
   * and a holder's write applies only while the row still carries the value
   * that holder last wrote or read, so a stalled holder cannot overwrite the
   * row of a call that took its claim over. A row with no value accepts the
   * first fenced write.
   */
  @Field("string")
  declare fence?: string;

  /**
   * The import writes through the rollup ledger, which is what lets it resume.
   * Rows older than the ledger have partial writes nothing can tell apart.
   */
  @Field("boolean")
  declare ledgered?: boolean;
}
