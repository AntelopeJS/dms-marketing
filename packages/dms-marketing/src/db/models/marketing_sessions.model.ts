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

  /**
   * One top-1 read per website, served by the `websiteId_lastSeenAt` index: a
   * group-max would fetch every retained session of every site. Websites with
   * no session are absent.
   */
  async getLastActivityByWebsites(
    websiteIds: string[],
  ): Promise<Map<string, number>> {
    const latest = await Promise.all(
      websiteIds.map(async (websiteId) => {
        const rows = await this.table
          .getAll(websiteId, "websiteId")
          .orderBy("lastSeenAt", "desc")
          .slice(0, 1)
          .pluck("lastSeenAt")
          .run();
        return [websiteId, rows[0]?.lastSeenAt] as const;
      }),
    );
    const activity = new Map<string, number>();
    for (const [websiteId, lastSeenAt] of latest) {
      if (lastSeenAt != null) {
        activity.set(websiteId, new Date(lastSeenAt).getTime());
      }
    }
    return activity;
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

  /** The most recent session of a website, for the install check. */
  async getLatest(websiteId: string): Promise<MarketingSession | undefined> {
    const rows = await this.table
      .getAll(websiteId, "websiteId")
      .orderBy("lastSeenAt", "desc")
      .slice(0, 1)
      .run();
    return rows[0];
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    return deleteExpiredRows(this.table, "lastSeenAt", cutoff);
  }

  async deleteByWebsite(websiteId: string): Promise<number> {
    return this.table.getAll([websiteId], "websiteId").delete().run();
  }
}
