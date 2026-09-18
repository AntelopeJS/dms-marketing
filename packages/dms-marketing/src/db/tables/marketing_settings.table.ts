import {
  Field,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const marketingSettingsTableName = "marketing_settings";

/**
 * Singleton document of the runtime-editable settings. Numeric fields
 * override the `DmsMarketingConfig` defaults, null meaning "use the
 * default"; also persists the generated visitor-hash secret.
 * Deployment-global (dms-core schema): retention and sampling drive the
 * cross-tenant prune.
 */
@RegisterTable(marketingSettingsTableName, CORE_SCHEMA_NAME)
export class MarketingSettings extends Table {
  @Field("boolean")
  declare trackerEnabled: boolean;

  @Field("number")
  declare rawEventsRetention: number | null;

  @Field("number")
  declare statisticsRetention: number | null;

  @Field("number")
  declare heatmapSampleRate: number | null;

  @Field("number")
  declare snapshotRetention: number | null;

  @Field("string")
  declare visitorHashSecret: string;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
