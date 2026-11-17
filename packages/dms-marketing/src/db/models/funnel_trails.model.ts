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

/** By timestamp, a stable sort: events sharing one keep their write order. */
function byTime(events: readonly StoredTrailEvent[]): StoredTrailEvent[] {
  return [...events].sort((a, b) => a.t - b.t);
}

/**
 * What a trail keeps of `events`, given in write order: each id once, the
 * earliest `MAX_TRAIL_EVENTS` by timestamp, those written first among events
 * sharing the last timestamp kept.
 */
function kept(events: readonly StoredTrailEvent[]): StoredTrailEvent[] {
  const unique = new Map<string, StoredTrailEvent>();
  for (const event of events) {
    if (!unique.has(event.i)) {
      unique.set(event.i, event);
    }
  }
  return byTime([...unique.values()]).slice(0, MAX_TRAIL_EVENTS);
}

function sameIds(
  a: readonly StoredTrailEvent[],
  b: readonly StoredTrailEvent[],
): boolean {
  return (
    a.length === b.length && a.every((event, index) => event.i === b[index].i)
  );
}

function newTrail(
  websiteId: string,
  sessionId: string,
  stored: readonly StoredTrailEvent[],
): FunnelTrail {
  const [firstAt, lastAt] = spanOf(stored);
  return {
    _id: sessionId,
    websiteId,
    events: kept(stored),
    firstAt,
    lastAt,
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
   * concurrent calls from any instance each land whole. Past
   * `MAX_TRAIL_EVENTS` the trail keeps the session's earliest events by
   * timestamp, whatever order they were written in.
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

  /**
   * One update of the row when the earliest events are plain to it: the row
   * and `stored` fit under the cap, or `stored` is later than every event
   * written to the row. Otherwise the kept events are computed from a read
   * of the row and written while the row still holds the events read, and a
   * row that changed in between is read again.
   */
  private async recordStored(
    websiteId: string,
    sessionId: string,
    stored: readonly StoredTrailEvent[],
  ): Promise<void> {
    if (stored.length === 0) {
      return;
    }
    const sorted = byTime(stored);
    while ((await this.union(sessionId, sorted)) === 0) {
      const row = await this.get(sessionId);
      const settled = row
        ? await this.replaceEvents(row, sorted)
        : await this.insertNew(newTrail(websiteId, sessionId, sorted));
      if (settled) {
        return;
      }
    }
  }

  private async insertNew(trail: FunnelTrail): Promise<boolean> {
    try {
      await this.table.insert(trail).run();
      return true;
    } catch (error) {
      if (!IsDuplicateKeyError(error)) {
        throw error;
      }
      return false;
    }
  }

  private async replaceEvents(
    row: FunnelTrail,
    sorted: readonly StoredTrailEvent[],
  ): Promise<boolean> {
    const events = kept([...row.events, ...sorted]);
    const [first, last] = spanOf(sorted);
    const firstAt = Math.min(row.firstAt, first);
    const lastAt = Math.max(row.lastAt, last);
    if (
      sameIds(events, row.events) &&
      firstAt === row.firstAt &&
      lastAt === row.lastAt
    ) {
      return true;
    }
    const held = ValueProxy.constant(row.events.map((event) => event.i));
    const replaced = await this.table
      .getAll([row._id])
      .filter((doc) =>
        doc
          .key("events")
          .map((event) => event.key("i"))
          .eq(held),
      )
      .update({ events, firstAt, lastAt })
      .run();
    return replaced > 0;
  }

  /**
   * Takes events back out of their sessions' trails, by event id, and deletes
   * the trails left empty: run before the events themselves are deleted, so
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
    sorted: readonly StoredTrailEvent[],
  ): Promise<number> {
    const [first, last] = spanOf(sorted);
    return this.table
      .getAll([sessionId])
      .filter((doc) =>
        doc
          .key("events")
          .default([])
          .count()
          .add(sorted.length)
          .le(MAX_TRAIL_EVENTS)
          .or(doc.key("lastAt").lt(first)),
      )
      .update((doc) => {
        const held = doc.key("events").default([]);
        return ValueProxy.constant([held.map((entry) => entry.key("i"))])
          .cast<string[][]>()
          .map((heldIds) =>
            ValueProxy.constant([...sorted]).filter((event) =>
              heldIds.includes(event.key("i")).not(),
            ),
          )
          .map((missing) => ({
            events: held.add(missing).slice(0, MAX_TRAIL_EVENTS),
            firstAt: ValueProxy.constant([doc.key("firstAt"), first])
              .cast<number[]>()
              .min(),
            lastAt: ValueProxy.constant([doc.key("lastAt"), last])
              .cast<number[]>()
              .max(),
          }))
          .index(0);
      })
      .run();
  }

  /**
   * The sessions with at least one event inside the window, streamed through
   * the table cursor: one row in memory at a time, whatever the window holds.
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
        yield { sessionId: row.sessionId, events: inTimeOrder(row.events) };
      }
    }
  }
}
