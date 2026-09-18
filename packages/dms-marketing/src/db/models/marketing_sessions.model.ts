import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  MarketingSession,
  marketingSessionsTableName,
} from "../tables/marketing_sessions.table";
import { deleteExpiredRows } from "./retention";

export interface SessionActivityDelta {
  pageviews: number;
  events: number;
  lastSeenAt: Date;
  exitUrl?: string;
}

export class MarketingSessionsModel extends BasicDataModel(
  MarketingSession,
  marketingSessionsTableName,
) {
  /**
   * Run on every collect batch that misses the session cache: getAll serves
   * the websiteId prefix of the compound index natively, the residual
   * visitorId filter and the sort walk the narrowed set.
   */
  async findLatestForVisitor(
    websiteId: string,
    visitorId: string,
  ): Promise<MarketingSession | undefined> {
    const results = await this.table
      .getAll(websiteId, "websiteId")
      .filter((doc) => doc.key("visitorId").eq(visitorId))
      .orderBy("startedAt", "desc")
      .slice(0, 1)
      .run();
    return results[0];
  }

  /** One server-side group-max; websites with no session are absent. */
  async getLastActivityByWebsites(
    websiteIds: string[],
  ): Promise<Map<string, number>> {
    if (websiteIds.length === 0) {
      return new Map();
    }
    const rows = await this.table
      .getAll(websiteIds, "websiteId")
      .group("websiteId", (stream, websiteId) => ({
        websiteId,
        lastSeenAt: stream.max("lastSeenAt"),
      }))
      .filter((row) => row.key("lastSeenAt").ne(null))
      .run();
    return new Map(
      rows.map((row) => [row.websiteId, new Date(row.lastSeenAt).getTime()]),
    );
  }

  /**
   * Fold one collect batch into the session's counters as a single native
   * update with server-side increments: concurrent batches (parallel beacons,
   * other instances) each add their own delta instead of overwriting the row
   * with whatever stale copy they hold.
   */
  async recordActivity(
    sessionId: string,
    delta: SessionActivityDelta,
  ): Promise<void> {
    await this.table
      .get(sessionId)
      .update((doc) => ({
        pageviewsCount: doc.key("pageviewsCount").add(delta.pageviews),
        eventsCount: doc.key("eventsCount").add(delta.events),
        lastSeenAt: delta.lastSeenAt,
        ...(delta.exitUrl !== undefined && { exitUrl: delta.exitUrl }),
      }))
      .run();
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    return deleteExpiredRows(this.table, "lastSeenAt", cutoff);
  }

  async deleteByWebsite(websiteId: string): Promise<number> {
    return this.table.getAll([websiteId], "websiteId").delete().run();
  }
}
