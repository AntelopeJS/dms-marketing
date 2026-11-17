import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  FunnelTrailBackfill,
  funnelTrailBackfillsTableName,
} from "../tables/funnel_trail_backfills.table";

/**
 * Bumped when what a trail keeps of an event changes (`toStored` in
 * `funnel_trails.model.ts`): every website's coverage then reads `none`, and
 * the next pass walks its events again.
 */
const TRAIL_BACKFILL_VERSION = 1;

/** What one website's funnel trails cover, parsed from its backfill row. */
export type TrailCoverage =
  | { kind: "none" }
  /** Every event with a timestamp strictly above `through` (epoch ms). */
  | { kind: "above"; through: number }
  | { kind: "all" };

/** Whether the trails hold every event at or after `since` (epoch ms). */
export function coversSince(coverage: TrailCoverage, since: number): boolean {
  switch (coverage.kind) {
    case "none":
      return false;
    case "above":
      return since > coverage.through;
    case "all":
      return true;
  }
}

function coverageOf(row: FunnelTrailBackfill | undefined): TrailCoverage {
  if (!row || row.version !== TRAIL_BACKFILL_VERSION) {
    return { kind: "none" };
  }
  if (row.done) {
    return { kind: "all" };
  }
  return row.through === null
    ? { kind: "none" }
    : { kind: "above", through: row.through };
}

export class FunnelTrailBackfillsModel extends BasicDataModel(
  FunnelTrailBackfill,
  funnelTrailBackfillsTableName,
) {
  async coverage(websiteId: string): Promise<TrailCoverage> {
    return coverageOf(await this.get(websiteId));
  }
}
