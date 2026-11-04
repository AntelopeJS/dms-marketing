import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  PageSnapshot,
  pageSnapshotsTableName,
} from "../tables/page_snapshots.table";
import { deleteExpiredRows, EPOCH_LOWER_BOUND } from "./retention";

export type PageSnapshotCapture = Pick<
  PageSnapshot,
  "url" | "layout" | "capturedAt" | "documentWidth"
>;

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

  /**
   * Every capture of one site without its document — what the pages list
   * tells per path, in one read. `documentWidth` is 0 on an oversize report.
   */
  async listCaptures(websiteId: string): Promise<PageSnapshotCapture[]> {
    return this.table
      .getAll([websiteId], "websiteId")
      .pluck("url", "layout", "capturedAt", "documentWidth")
      .run();
  }

  /** Captures of one site, or of one path when `url` is given. */
  async countByWebsite(websiteId: string, url?: string): Promise<number> {
    return this.byWebsite(websiteId, url).count().run();
  }

  async upsert(row: PageSnapshot): Promise<void> {
    await this.table.insert(row, { conflict: "replace" }).run();
  }

  async deleteByWebsite(websiteId: string, url?: string): Promise<number> {
    return this.byWebsite(websiteId, url).delete().run();
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    return deleteExpiredRows(
      this.table,
      "capturedAt",
      EPOCH_LOWER_BOUND,
      cutoff,
    );
  }

  /** One query for count and delete, so the two agree. */
  private byWebsite(websiteId: string, url?: string) {
    const rows = this.table.getAll([websiteId], "websiteId");
    return url ? rows.filter((doc) => doc.key("url").eq(url)) : rows;
  }
}
