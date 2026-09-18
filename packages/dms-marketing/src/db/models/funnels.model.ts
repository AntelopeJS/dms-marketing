import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  Funnel,
  type FunnelExperiment,
  funnelsTableName,
} from "../tables/funnels.table";

const RUNNING_STATUS = "running";

export class FunnelsModel extends BasicDataModel(Funnel, funnelsTableName) {
  /** The only slice the public assignments script serves. */
  async listRunning(websiteId: string): Promise<Funnel[]> {
    return this.table
      .getAll(websiteId, "websiteId")
      .filter((doc) =>
        doc
          .key("experiment")
          .cast<FunnelExperiment>()
          .key("status")
          .eq(RUNNING_STATUS),
      )
      .run();
  }

  /**
   * Existence probe behind the per-website key uniqueness rule. A count, not
   * a load: the answer is one number, and the site's whole set has no reason
   * to travel for it. `excludeId` is the row being edited — comparing itself
   * to itself is not a duplicate.
   */
  async hasKey(
    websiteId: string,
    key: string,
    excludeId?: string,
  ): Promise<boolean> {
    let q = this.table
      .getAll(websiteId, "websiteId")
      .filter((doc) =>
        doc.key("experiment").cast<FunnelExperiment>().key("key").eq(key),
      );
    if (excludeId !== undefined) {
      q = q.filter((doc) => doc.key("_id").ne(excludeId));
    }
    return (await q.count().run()) > 0;
  }

  /**
   * Sites the given rows belong to, deduplicated server-side: the delete
   * path invalidates their definition caches and needs nothing else off them.
   */
  async listWebsiteIdsOf(ids: string[]): Promise<string[]> {
    if (ids.length === 0) {
      return [];
    }
    return this.table
      .getAll(ids)
      .map((doc) => doc.key("websiteId"))
      .distinct()
      .run();
  }
}
