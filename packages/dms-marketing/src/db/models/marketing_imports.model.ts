import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  MarketingImport,
  marketingImportsTableName,
} from "../tables/marketing_imports.table";

export class MarketingImportsModel extends BasicDataModel(
  MarketingImport,
  marketingImportsTableName,
) {
  async deleteByWebsite(websiteId: string): Promise<number> {
    return this.table.getAll(websiteId, "websiteId").delete().run();
  }
}
