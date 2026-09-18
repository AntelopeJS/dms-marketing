import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { Website, websitesTableName } from "../tables/websites.table";

export class WebsitesModel extends BasicDataModel(Website, websitesTableName) {
  async getByTenant(tenantId: string): Promise<Website[]> {
    return this.table
      .getAll(tenantId, "tenantId")
      .orderBy("createdAt", "desc")
      .run();
  }

  /** Ids alone, for the read paths that only need a website SET to scope on. */
  async listIdsByTenant(tenantId: string): Promise<string[]> {
    return this.table
      .getAll(tenantId, "tenantId")
      .map((doc) => doc.key("_id"))
      .run();
  }

  async listTenantIds(): Promise<string[]> {
    return this.table.distinct("tenantId").run();
  }

  async deleteByTenant(tenantId: string): Promise<void> {
    await this.table.getAll(tenantId, "tenantId").delete().run();
  }
}
