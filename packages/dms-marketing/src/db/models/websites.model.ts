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

  /** The sites among `ids` that exist, in no particular order. */
  async getMany(ids: string[]): Promise<Website[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await this.table.getAll(ids).run();
    return rows
      .map((row) => WebsitesModel.fromDatabase(row))
      .filter((website) => website !== undefined);
  }

  async listTenantIds(): Promise<string[]> {
    return this.table.distinct("tenantId").run();
  }

  async deleteByTenant(tenantId: string): Promise<void> {
    await this.table.getAll(tenantId, "tenantId").delete().run();
  }
}
