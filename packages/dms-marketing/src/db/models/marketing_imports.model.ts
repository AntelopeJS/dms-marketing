import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  MarketingImport,
  marketingImportsTableName,
} from "../tables/marketing_imports.table";

export class MarketingImportsModel extends BasicDataModel(
  MarketingImport,
  marketingImportsTableName,
) {
  async listByWebsite(websiteId: string): Promise<MarketingImport[]> {
    return this.table.getAll(websiteId, "websiteId").run();
  }

  /** Never release an acquisition owned by another instance. */
  async releaseClaim(id: string, token: string): Promise<void> {
    const outcome = await this.table
      .atomicMutation(id, {
        type: "deleteIfEqual",
        field: "claimToken",
        expectedValue: token,
      })
      .run();
    if (outcome !== "applied") {
      throw new Error("Analytics import claim release was not confirmed");
    }
  }

  async deleteByWebsite(websiteId: string): Promise<number> {
    return this.table.getAll(websiteId, "websiteId").delete().run();
  }
}
