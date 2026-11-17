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
  /** The trail was cut at `MAX_TRAIL_EVENTS`: some of the session is missing. */
  overflowed: boolean;
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

/** Stable: events sharing a timestamp keep their stored order. */
function inTimeOrder(stored: readonly StoredTrailEvent[]): TrailEvent[] {
  return stored.map(toTrailEvent).sort((a, b) => a.at - b.at);
}

function isStored(
  stored: StoredTrailEvent | undefined,
): stored is StoredTrailEvent {
  return stored !== undefined;
}

/** The oldest and newest timestamps of a non-empty list of events. */
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
  const events = stored.slice(0, MAX_TRAIL_EVENTS);
  const [firstAt, lastAt] = spanOf(events);
  return {
    _id: sessionId,
    websiteId,
    events,
    firstAt,
    lastAt,
    overflowed: stored.length > MAX_TRAIL_EVENTS,
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
   * A set union on the event ids, in one native update: an event the trail
   * already holds is not added again, so a retried or repeated call changes
   * nothing, and concurrent calls from any instance each land whole. The
   * first write of a session finds no row and inserts it; losing that insert
   * to another writer falls back to the update.
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
   * each session's events in time order. The same union as {@link record},
   * in fewer round trips: one read of the event ids the trails already hold,
   * one insert of the sessions that have no trail yet, and a union per
   * session that has one and misses some of its events. Losing an insert to
   * another writer falls back to the per-session union.
   */
  async recordMany(
    websiteId: string,
    sessions: ReadonlyMap<string, readonly TrailedEvent[]>,
  ): Promise<void> {
    const held = await this.heldEventIds([...sessions.keys()]);
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
      if (known) {
        await this.recordStored(websiteId, sessionId, stored);
      } else {
        fresh.set(sessionId, stored);
      }
    }
    if (fresh.size === 0) {
      return;
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
  }

  /**
   * The union of {@link record}: the update first, then the insert of a
   * session with no trail, then the update again when another writer
   * inserted it first.
   */
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
   * the trails left empty: run before the events themselves are deleted, so
   * a stop in between leaves the events to be found and forgotten again.
   */
  async forgetEvents(
    events: readonly Pick<MarketingEvent, "_id" | "sessionId">[],
  ): Promise<void> {
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
        .update((doc) => {
          const kept = () =>
            doc
              .key("events")
              .default([])
              .filter((event) => gone.includes(event.key("i")).not());
          return {
            events: kept(),
            firstAt: kept()
              .map((event) => event.key("t"))
              .min(),
            lastAt: kept()
              .map((event) => event.key("t"))
              .max(),
          };
        })
        .run();
    }
    await this.table
      .getAll([...bySession.keys()])
      .filter((doc) => doc.key("events").default([]).isempty())
      .delete()
      .run();
  }

  /**
   * The raw events' retention, applied to the trails: a trail goes once its
   * newest event is older than `cutoff`. A trail that straddles it keeps its
   * older events until then, and the reads start at the cutoff.
   */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    return deleteExpiredRows(this.table, "lastAt", 0, cutoff.getTime());
  }

  async deleteByWebsite(websiteId: string): Promise<number> {
    return this.table.getAll([websiteId], "websiteId").delete().run();
  }

  /** The event ids each existing trail of `sessionIds` holds. */
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

  /**
   * Unions `stored` into an existing row, cut at `MAX_TRAIL_EVENTS`; resolves
   * to 0 when no row exists or it already held every event.
   *
   * `merged` builds a new expression on each call: the adapter decodes the
   * fields of an update concurrently, and one list function decoded in two
   * fields at once binds its variable under two names.
   */
  private union(
    sessionId: string,
    stored: StoredTrailEvent[],
  ): Promise<number> {
    const incoming = ValueProxy.constant(stored);
    const [first, last] = spanOf(stored);
    return this.table
      .get(sessionId)
      .update((doc) => {
        const held = doc.key("events").default([]);
        const merged = () =>
          held.add(
            incoming.filter((event) =>
              held
                .map((entry) => entry.key("i"))
                .includes(event.key("i"))
                .not(),
            ),
          );
        return {
          events: merged().slice(0, MAX_TRAIL_EVENTS),
          firstAt: ValueProxy.constant([doc.key("firstAt"), first])
            .cast<number[]>()
            .min(),
          lastAt: ValueProxy.constant([doc.key("lastAt"), last])
            .cast<number[]>()
            .max(),
          overflowed: doc
            .key("overflowed")
            .default(false)
            .or(merged().count().gt(MAX_TRAIL_EVENTS)),
        };
      })
      .run();
  }

  /**
   * The sessions with at least one event inside the window, streamed through
   * the table cursor: one row in memory at a time, whatever the window holds.
   * The window and the kinds are filtered on the server, so only the events
   * read come back.
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
        overflowed: doc.key("overflowed").default(false),
        events: doc.key("events").filter((event) =>
          event
            .key("t")
            .ge(query.since)
            .and(event.key("t").le(query.until))
            .and(kinds.includes(event.key("k"))),
        ),
      }));
    for await (const row of rows.cursor()) {
      if (row.events.length > 0) {
        yield {
          sessionId: row.sessionId,
          overflowed: row.overflowed,
          events: inTimeOrder(row.events),
        };
      }
    }
  }
}
