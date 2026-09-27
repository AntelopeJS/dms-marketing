import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  MarketingSettings,
  marketingSettingsTableName,
} from "../tables/marketing_settings.table";

/**
 * Fixed primary key of the singleton: the key itself is the uniqueness
 * constraint, so concurrent first inserts collide instead of creating two
 * rows with two visitor-hash secrets.
 */
export const MARKETING_SETTINGS_ID = "settings";

export class MarketingSettingsModel extends BasicDataModel(
  MarketingSettings,
  marketingSettingsTableName,
) {
  /** Rows created before the fixed key existed carry a random id; the
   * unordered fallback keeps them readable without a migration. */
  async getSingleton(): Promise<MarketingSettings | undefined> {
    const row =
      (await this.table.get(MARKETING_SETTINGS_ID).run()) ??
      (await this.table.nth(0).run());
    return MarketingSettingsModel.fromDatabase(row);
  }

  /**
   * Inserts the singleton under its fixed key and returns the row in force.
   * Losing the race to another instance returns the winner's row — probed by
   * state rather than by error, since the database interface exposes no typed
   * conflict error: a row present after a failed insert IS the lost race.
   * Stamps the fixed key on `doc`.
   */
  async insertSingleton(doc: MarketingSettings): Promise<MarketingSettings> {
    doc._id = MARKETING_SETTINGS_ID;
    try {
      await this.insert(doc);
      return doc;
    } catch (error) {
      const winner = await this.getSingleton();
      if (!winner) {
        throw error;
      }
      return winner;
    }
  }
}
