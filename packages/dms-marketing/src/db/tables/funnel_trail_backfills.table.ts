import {
  Field,
  RegisterTable,
  Table,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const funnelTrailBackfillsTableName = "marketing_funnel_trail_backfills";

/**
 * How far one website's funnel trails cover its raw events. `_id` is the
 * website id. The backfill walks the events newest first, so the claim is a
 * lower bound: every event with a timestamp strictly above `through` is in
 * the trails, and `done` means every event is. A missing row, or a row of an
 * older `version`, covers nothing.
 *
 * Writes only widen the claim (`through` goes down, `done` is never unset),
 * so two instances walking one website each write a true claim.
 */
@RegisterTable(funnelTrailBackfillsTableName, TENANT_SCHEMA_NAME)
export class FunnelTrailBackfill extends Table {
  @Field("number")
  declare version: number;

  /** Epoch milliseconds; null before the first flush. */
  @Field("number")
  declare through: number | null;

  @Field("boolean")
  declare done: boolean;

  /**
   * Moved before events of the website are deleted (a purge, an import
   * discard): a walk that sees it move stops.
   */
  @Field("number")
  declare generation: number;
}
