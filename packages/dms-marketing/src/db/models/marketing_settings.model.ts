import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  MarketingSettings,
  marketingSettingsTableName,
} from "../tables/marketing_settings.table";

export class MarketingSettingsModel extends BasicDataModel(
  MarketingSettings,
  marketingSettingsTableName,
) {
  async getSingleton(): Promise<MarketingSettings | undefined> {
    const row = await this.table.nth(0).run();
    return MarketingSettingsModel.fromDatabase(row);
  }
}
