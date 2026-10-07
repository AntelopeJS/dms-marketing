import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  MarketingPreferences,
  marketingPreferencesTableName,
} from "../tables/marketing_preferences.table";

export class MarketingPreferencesModel extends BasicDataModel(
  MarketingPreferences,
  marketingPreferencesTableName,
) {
  async getWebsiteId(userId: string): Promise<string | undefined> {
    const row = await this.table.get(userId).run();
    return row?.websiteId;
  }

  async setWebsiteId(userId: string, websiteId: string): Promise<void> {
    const existing = await this.table.get(userId).run();
    if (existing) {
      await this.table
        .get(userId)
        .update({ websiteId, updatedAt: new Date() })
        .run();
      return;
    }
    await this.table
      .insert({ _id: userId, websiteId, updatedAt: new Date() })
      .run();
  }
}
