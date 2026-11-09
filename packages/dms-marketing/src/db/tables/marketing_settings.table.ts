import {
  Field,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { CORE_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const marketingSettingsTableName = "marketing_settings";

/**
 * Singleton document of the runtime-editable settings. Each field
 * overrides its `DmsMarketingConfig` value, null meaning "use the module
 * config"; also persists the generated visitor-hash secret.
 * Deployment-global (dms-core schema): retention and sampling drive the
 * cross-tenant prune.
 */
@RegisterTable(marketingSettingsTableName, CORE_SCHEMA_NAME)
export class MarketingSettings extends Table {
  @Field("boolean")
  declare trackerEnabled: boolean | null;

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
