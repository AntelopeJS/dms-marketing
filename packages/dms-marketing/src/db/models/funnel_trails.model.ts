import {
  IsDuplicateKeyError,
  ValueProxy,
} from "@antelopejs/interface-database";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import { MAX_TRAIL_EVENTS } from "@/types/constants";
import { isObject, isString } from "@/utils/guards";
import {
  FunnelTrail,
  funnelTrailsTableName,
  type StoredTrailEvent,
} from "../tables/funnel_trails.table";
import type { MarketingEvent } from "../tables/marketing_events.table";
import { deleteExpiredRows } from "./retention";

/**
 * A funnel event as funnels, splits and templates read it. Each kind carries
 * the one value they read off it: the path of a pageview, the name of a custom
 * event, the experiment and variation of an exposure.
 */
export type TrailEvent =
  | { kind: "pageview"; at: number; path: string }
  | { kind: "custom"; at: number; name: string | null }
  | {
      kind: "exposure";
      at: number;
      experiment: string | null;
      variation: string | null;
    };

/** One session's events inside a read window. */
export interface TrailSession {
  sessionId: string;
  /**
   * By timestamp. Events sharing one keep the order they were written in,
   * which for one collect batch is the order of its events.
   */
  events: TrailEvent[];
  /**
   * The trail dropped events past `MAX_TRAIL_EVENTS` at or before the
   * window's end: some of the session inside the window may be missing.
   */
  incomplete: boolean;
}

export interface TrailWindowQuery {
  websiteId: string;
  /** Epoch milliseconds, both bounds included. */
  since: number;
  until: number;
  /** Exposures are read for a split only. */
  withExposures: boolean;
}

/** What a trail keeps of an event, from a row of `marketing_events`. */
export type TrailedEvent = Pick<
  MarketingEvent,
  "_id" | "kind" | "timestamp" | "url" | "name" | "data"
>;

/** An event of a trail, named by its id and its session. */
export type TrailEventRef = Pick<MarketingEvent, "_id" | "sessionId">;

const FUNNEL_KINDS: StoredTrailEvent["k"][] = ["p", "c"];
const SPLIT_KINDS: StoredTrailEvent["k"][] = [...FUNNEL_KINDS, "x"];

function variationOf(data: MarketingEvent["data"]): string | null {
  return isObject(data) && "variation" in data && isString(data.variation)
    ? data.variation
    : null;
}

function toStored(event: TrailedEvent): StoredTrailEvent | undefined {
  const i = event._id;
  const t = event.timestamp.getTime();
  switch (event.kind) {
    case "pageview":
      return { i, t, k: "p", v: event.url };
    case "custom":
      return { i, t, k: "c", v: event.name ?? null };
    case "exposure":
      return {
        i,
        t,
        k: "x",
        v: event.name ?? null,
        a: variationOf(event.data),
      };
    default:
      return undefined;
  }
}

function toTrailEvent(stored: StoredTrailEvent): TrailEvent {
  switch (stored.k) {
    case "p":
      return { kind: "pageview", at: stored.t, path: stored.v };
    case "c":
      return { kind: "custom", at: stored.t, name: stored.v };
    case "x":
      return {
        kind: "exposure",
        at: stored.t,
        experiment: stored.v,
        variation: stored.a,
      };
  }
}

function inTimeOrder(stored: readonly StoredTrailEvent[]): TrailEvent[] {
  return stored.map(toTrailEvent).sort((a, b) => a.at - b.at);
}

function isStored(
  stored: StoredTrailEvent | undefined,
): stored is StoredTrailEvent {
  return stored !== undefined;
}

function spanOf(stored: readonly StoredTrailEvent[]): [number, number] {
  return stored.reduce<[number, number]>(
    ([first, last], event) => [
      Math.min(first, event.t),
      Math.max(last, event.t),
    ],
    [Infinity, -Infinity],
  );
}

function newTrail(
  websiteId: string,
  sessionId: string,
  stored: readonly StoredTrailEvent[],
): FunnelTrail {
  const [firstAt, lastAt] = spanOf(stored);
  const dropped = stored.slice(MAX_TRAIL_EVENTS);
  return {
    _id: sessionId,
    websiteId,
    events: stored.slice(0, MAX_TRAIL_EVENTS),
    firstAt,
    lastAt,
    firstDroppedAt: dropped.length > 0 ? spanOf(dropped)[0] : null,
  };
}

export class FunnelTrailsModel extends BasicDataModel(
  FunnelTrail,
  funnelTrailsTableName,
) {
  /**
   * Adds events of one session to its trail: the ingestion write. Events of
   * other kinds are skipped, and a call left with none writes nothing.
   *
   * A set union on the event ids: an event the trail already holds is not
   * added again, so a retried or repeated call changes nothing, and
   * concurrent calls from any instance each land whole.
   */
  async record(
    websiteId: string,
    sessionId: string,
    events: readonly TrailedEvent[],
  ): Promise<void> {
    await this.recordStored(
      websiteId,
      sessionId,
      events.map(toStored).filter(isStored),
    );
  }

  /**
   * Adds events of many sessions to their trails: the backfill's write, with
   * each session's events in time order. The same union as {@link record}.
   *
   * Resolves to the events it wrote: those the trails did not hold when it
   * read their ids. An event another writer held already is not among them,
   * so {@link forgetEvents} on the result never takes that write back.
   */
  async recordMany(
    websiteId: string,
    sessions: ReadonlyMap<string, readonly TrailedEvent[]>,
  ): Promise<TrailEventRef[]> {
    const held = await this.heldEventIds([...sessions.keys()]);
    const written: TrailEventRef[] = [];
    const fresh = new Map<string, StoredTrailEvent[]>();
    for (const [sessionId, events] of sessions) {
      const known = held.get(sessionId);
      const stored = events
        .map(toStored)
        .filter(isStored)
        .filter((event) => !known?.has(event.i));
      if (stored.length === 0) {
        continue;
      }
      written.push(...stored.map((event) => ({ _id: event.i, sessionId })));
      if (known) {
        await this.recordStored(websiteId, sessionId, stored);
      } else {
        fresh.set(sessionId, stored);
      }
    }
    if (fresh.size === 0) {
      return written;
    }
    const trails = [...fresh].map(([sessionId, stored]) =>
      newTrail(websiteId, sessionId, stored),
    );
    try {
      await this.table.insert(trails).run();
    } catch (error) {
      if (!IsDuplicateKeyError(error)) {
        throw error;
      }
      for (const [sessionId, stored] of fresh) {
        await this.recordStored(websiteId, sessionId, stored);
      }
    }
    return written;
  }

  private async recordStored(
    websiteId: string,
    sessionId: string,
    stored: StoredTrailEvent[],
  ): Promise<void> {
    if (stored.length === 0 || (await this.union(sessionId, stored)) > 0) {
      return;
    }
    try {
      await this.table.insert(newTrail(websiteId, sessionId, stored)).run();
    } catch (error) {
      if (!IsDuplicateKeyError(error)) {
        throw error;
      }
      await this.union(sessionId, stored);
    }
  }

  /**
   * Takes events back out of their sessions' trails, by event id, and deletes
   * the trails left empty that never dropped an event: run before the events themselves are deleted, so
   * a stop in between leaves the events to be found and forgotten again.
   */
  async forgetEvents(events: readonly TrailEventRef[]): Promise<void> {
    const bySession = new Map<string, string[]>();
    for (const event of events) {
      bySession.set(event.sessionId, [
        ...(bySession.get(event.sessionId) ?? []),
        event._id,
      ]);
    }
    for (const [sessionId, ids] of bySession) {
      const gone = ValueProxy.constant(ids);
      await this.table
        .get(sessionId)
        .update((doc) => ({
          events: doc
            .key("events")
            .default([])
            .filter((event) => gone.includes(event.key("i")).not()),
        }))
        .run();
    }
    await this.table
      .getAll([...bySession.keys()])
      .filter((doc) => doc.key("events").default([]).isempty())
      .filter((doc) => doc.key("firstDroppedAt").default(null).eq(null))
      .delete()
      .run();
  }

  /**
   * The raw events' retention, applied to the trails at the instant it cut
   * the events at: a trail whose newest event is older than `cutoff` goes,
   * and a trail that straddles it loses its older events in one update, its
   * `firstAt` moved up to the cutoff, a lower bound of the events left.
   * Resolves to the number of trails deleted.
   */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    const at = cutoff.getTime();
    const deleted = await deleteExpiredRows(this.table, "lastAt", 0, at);
    await this.table
      .between("firstAt", 0, at)
      .filter((doc) => doc.key("lastAt").ge(at))
      .update((doc) => ({
        events: doc.key("events").filter((event) => event.key("t").ge(at)),
        firstAt: at,
      }))
      .run();
    return deleted;
  }

  async deleteByWebsite(websiteId: string): Promise<number> {
    return this.table.getAll([websiteId], "websiteId").delete().run();
  }

  private async heldEventIds(
    sessionIds: readonly string[],
  ): Promise<Map<string, Set<string>>> {
    const rows = await this.table
      .getAll([...sessionIds])
      .map((doc) => ({
        sessionId: doc.key("_id"),
        ids: doc.key("events").map((event) => event.key("i")),
      }))
      .run();
    return new Map(rows.map((row) => [row.sessionId, new Set(row.ids)]));
  }

  private union(
    sessionId: string,
    stored: StoredTrailEvent[],
  ): Promise<number> {
    const [first, last] = spanOf(stored);
    return this.table
      .get(sessionId)
      .update((doc) => {
        const held = doc.key("events").default([]);
        return ValueProxy.constant([held.map((entry) => entry.key("i"))])
          .cast<string[][]>()
          .map((heldIds) =>
            ValueProxy.constant(stored).filter((event) =>
              heldIds.includes(event.key("i")).not(),
            ),
          )
          .map((missing) => held.add(missing))
          .map((merged) => ({
            events: merged.slice(0, MAX_TRAIL_EVENTS),
            firstAt: ValueProxy.constant([doc.key("firstAt"), first])
              .cast<number[]>()
              .min(),
            lastAt: ValueProxy.constant([doc.key("lastAt"), last])
              .cast<number[]>()
              .max(),
            firstDroppedAt: ValueProxy.constant([doc.key("firstDroppedAt")])
              .cast<number[]>()
              .add(
                merged.slice(MAX_TRAIL_EVENTS).map((event) => event.key("t")),
              )
              .min(),
          }))
          .index(0);
      })
      .run();
  }

  /**
   * The sessions with at least one event inside the window, or that dropped
   * events at or before its end, streamed through the table cursor: one row
   * in memory at a time, whatever the window holds.
   */
  async *sessionsIn(query: TrailWindowQuery): AsyncGenerator<TrailSession> {
    const kinds = ValueProxy.constant(
      query.withExposures ? SPLIT_KINDS : FUNNEL_KINDS,
    );
    const rows = this.table
      .getAll([query.websiteId], "websiteId")
      .filter((doc) => doc.key("lastAt").ge(query.since))
      .filter((doc) => doc.key("firstAt").le(query.until))
      .map((doc) => ({
        sessionId: doc.key("_id"),
        firstDroppedAt: doc.key("firstDroppedAt"),
        events: doc.key("events").filter((event) =>
          event
            .key("t")
            .ge(query.since)
            .and(event.key("t").le(query.until))
            .and(kinds.includes(event.key("k"))),
        ),
      }));
    for await (const row of rows.cursor()) {
      const incomplete =
        row.firstDroppedAt !== null && row.firstDroppedAt <= query.until;
      if (row.events.length > 0 || incomplete) {
        yield {
          sessionId: row.sessionId,
          incomplete,
          events: inTimeOrder(row.events),
        };
      }
    }
  }
}
