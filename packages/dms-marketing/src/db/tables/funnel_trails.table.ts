import {
  Field,
  Index,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const funnelTrailsTableName = "marketing_funnel_trails";

const WEBSITE_LAST_AT_INDEX = "websiteId_lastAt";

/**
 * One event of a trail as stored, under short keys.
 *
 * - `i`: the event's `_id`, the key every write unions on.
 * - `t`: the event's timestamp, epoch milliseconds.
 * - `k`: `p` pageview, `c` custom event, `x` exposure.
 * - `v`: the pageview's path, the custom event's name, the exposure's
 *   experiment key.
 * - `a`: the exposure's variation, when its `data.variation` is a string.
 */
export type StoredTrailEvent =
  | { i: string; t: number; k: "p"; v: string }
  | { i: string; t: number; k: "c"; v: string | null }
  | { i: string; t: number; k: "x"; v: string | null; a: string | null };

/**
 * Per session, its funnel events (pageviews, custom events, exposures) of
 * `marketing_events`: an index of the raw events that funnels, splits and
 * templates read instead of the events themselves. It follows the raw events'
 * retention, and `services/funnels/trail-backfill` brings in the events
 * written before it existed. It holds no funnel definition, so an edited
 * funnel, an unsaved draft and the templates read it as they read the events.
 *
 * `_id` is the session id. `events` holds each event once, in the order it
 * was written, up to `MAX_TRAIL_EVENTS`. `firstAt` and `lastAt` bound the
 * timestamps of the events written to it, in epoch milliseconds, the dropped
 * ones included: each write widens them to the events it adds, a write that
 * takes events out recomputes them from the events left, and the retention
 * trim moves `firstAt` up to its cutoff.
 */
@RegisterTable(funnelTrailsTableName, TENANT_SCHEMA_NAME)
export class FunnelTrail extends Table {
  @Index({ group: WEBSITE_LAST_AT_INDEX })
  @Field("string")
  declare websiteId: string;

  @Index({ group: WEBSITE_LAST_AT_INDEX })
  @Index()
  @Field("number")
  declare lastAt: number;

  @Index()
  @Field("number")
  declare firstAt: number;

  @Field("any")
  declare events: StoredTrailEvent[];

  /**
   * The oldest timestamp of an event dropped at `MAX_TRAIL_EVENTS`, epoch
   * milliseconds; null while none was. A window ending before it holds every
   * event of the session.
   */
  @Field("number")
  declare firstDroppedAt: number | null;
}
