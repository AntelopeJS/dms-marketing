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

  /** Captures of one site, or of one path when `url` is given. */
  async countByWebsite(websiteId: string, url?: string): Promise<number> {
    return this.byWebsite(websiteId, url).count().run();
  }

  async upsert(row: PageSnapshot): Promise<void> {
    await this.table.insert(row, { conflict: "replace" }).run();
  }

  /**
   * Rewrites a row only while it is still the one read (same capture time,
   * same declaration): MongoDB evaluates the predicate inside the write, so
   * a capture landing in between is never overwritten.
   */
  async replaceIfUnchanged(
    expected: PageSnapshot,
    patch: Partial<PageSnapshot>,
  ): Promise<boolean> {
    const count = await this.table
      .filter((row) =>
        row
          .key("_id")
          .eq(expected._id)
          .and(row.key("capturedAt").eq(expected.capturedAt))
          .and(
            row
              .key("declaredHash")
              .default("")
              .eq(expected.declaredHash ?? ""),
          ),
      )
      .update(PageSnapshotsModel.toDatabase(patch))
      .run();
    return count === 1;
  }

  async deleteByWebsite(websiteId: string, url?: string): Promise<number> {
    return this.byWebsite(websiteId, url).delete().run();
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    return deleteExpiredRows(this.table, "capturedAt", cutoff);
  }

  /** One query for count and delete, so the two agree. */
  private byWebsite(websiteId: string, url?: string) {
    const rows = this.table.getAll([websiteId], "websiteId");
    return url ? rows.filter((doc) => doc.key("url").eq(url)) : rows;
  }
}
