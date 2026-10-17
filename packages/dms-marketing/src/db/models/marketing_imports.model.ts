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

  /**
   * Per website, the latest instant its completed imports filled (epoch ms):
   * activity no newer than it came from an import. Websites without a
   * completed import are absent.
   */
  async getImportedThroughByWebsites(
    websiteIds: string[],
  ): Promise<Map<string, number>> {
    const rows = await Promise.all(
      websiteIds.map((websiteId) => this.listByWebsite(websiteId)),
    );
    const through = new Map<string, number>();
    for (const row of rows.flat()) {
      if (row.status === "done" && row.importedThrough) {
        const at = new Date(row.importedThrough).getTime();
        through.set(
          row.websiteId,
          Math.max(through.get(row.websiteId) ?? at, at),
        );
      }
    }
    return through;
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
