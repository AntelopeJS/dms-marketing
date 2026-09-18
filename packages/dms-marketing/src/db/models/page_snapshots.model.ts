import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  PageSnapshot,
  pageSnapshotsTableName,
} from "../tables/page_snapshots.table";
import { deleteExpiredRows } from "./retention";

export class PageSnapshotsModel extends BasicDataModel(
  PageSnapshot,
  pageSnapshotsTableName,
) {
  /** Every layout captured for one path — three rows at most. */
  async getByPath(websiteId: string, url: string): Promise<PageSnapshot[]> {
    return this.table
      .getAll([websiteId], "websiteId")
      .filter((doc) => doc.key("url").eq(url))
      .run();
  }

  async countByWebsite(websiteId: string): Promise<number> {
    return this.table.getAll([websiteId], "websiteId").count().run();
  }

  async upsert(row: PageSnapshot): Promise<void> {
    await this.table.insert(row, { conflict: "replace" }).run();
  }

  async deleteByWebsite(websiteId: string, url?: string): Promise<number> {
    let q = this.table.getAll([websiteId], "websiteId");
    if (url) {
      q = q.filter((doc) => doc.key("url").eq(url));
    }
    return q.delete().run();
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    return deleteExpiredRows(this.table, "capturedAt", cutoff);
  }
}
