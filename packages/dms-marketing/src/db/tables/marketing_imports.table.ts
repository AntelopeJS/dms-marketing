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
 * written, so an import id is replayed once even across instances. A failed
 * import keeps its row — what it wrote stays counted, and replaying it would
 * count it twice.
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
}
