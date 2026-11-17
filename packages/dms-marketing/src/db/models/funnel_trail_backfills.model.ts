import { IsDuplicateKeyError } from "@antelopejs/interface-database";
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

/** Where a walk of one website starts, and the purge generation it walks in. */
export interface TrailWalkStart {
  coverage: TrailCoverage;
  generation: number;
}

export class FunnelTrailBackfillsModel extends BasicDataModel(
  FunnelTrailBackfill,
  funnelTrailBackfillsTableName,
) {
  async coverage(websiteId: string): Promise<TrailCoverage> {
    return coverageOf(await this.get(websiteId));
  }

  /**
   * The website's row of the current version, created covering nothing when
   * it has none, and reset to cover nothing when it is of an older version.
   */
  async begin(websiteId: string): Promise<TrailWalkStart> {
    const row = await this.get(websiteId);
    if (row?.version === TRAIL_BACKFILL_VERSION) {
      return { coverage: coverageOf(row), generation: row.generation };
    }
    if (row) {
      await this.table
        .getAll([websiteId])
        .filter((doc) => doc.key("version").ne(TRAIL_BACKFILL_VERSION))
        .update({ version: TRAIL_BACKFILL_VERSION, through: null, done: false })
        .run();
      return { coverage: { kind: "none" }, generation: row.generation };
    }
    try {
      await this.table
        .insert({
          _id: websiteId,
          version: TRAIL_BACKFILL_VERSION,
          through: null,
          done: false,
          generation: 0,
        })
        .run();
    } catch (error) {
      if (!IsDuplicateKeyError(error)) {
        throw error;
      }
    }
    return { coverage: { kind: "none" }, generation: 0 };
  }

  /** Undefined once the row is gone: the website was deleted. */
  async generationOf(websiteId: string): Promise<number | undefined> {
    return (await this.get(websiteId))?.generation;
  }

  /**
   * Claims every event above `through` (epoch ms) as in the trails, when the
   * row of `generation` claims less: a slower walker writes nothing.
   */
  async widen(
    websiteId: string,
    generation: number,
    through: number,
  ): Promise<void> {
    await this.ofGeneration(websiteId, generation)
      .filter((doc) => doc.key("done").eq(false))
      .filter((doc) =>
        doc.key("through").eq(null).or(doc.key("through").gt(through)),
      )
      .update({ through })
      .run();
  }

  /** Claims every event as in the trails: the walk ran out of events. */
  async complete(websiteId: string, generation: number): Promise<void> {
    await this.ofGeneration(websiteId, generation).update({ done: true }).run();
  }

  /**
   * A purge left the website no event: everything is covered, and the moved
   * generation stops a walk of the purged events on any instance at its next
   * flush.
   */
  async purged(websiteId: string): Promise<void> {
    const purge = () =>
      this.table
        .get(websiteId)
        .update((doc) => ({
          version: TRAIL_BACKFILL_VERSION,
          through: null,
          done: true,
          generation: doc.key("generation").add(1),
        }))
        .run();
    if ((await purge()) > 0) {
      return;
    }
    try {
      await this.table
        .insert({
          _id: websiteId,
          version: TRAIL_BACKFILL_VERSION,
          through: null,
          done: true,
          generation: 1,
        })
        .run();
    } catch (error) {
      if (!IsDuplicateKeyError(error)) {
        throw error;
      }
      await purge();
    }
  }

  async deleteByWebsite(websiteId: string): Promise<number> {
    return this.table.get(websiteId).delete().run();
  }

  private ofGeneration(websiteId: string, generation: number) {
    return this.table
      .getAll([websiteId])
      .filter((doc) =>
        doc
          .key("version")
          .eq(TRAIL_BACKFILL_VERSION)
          .and(doc.key("generation").eq(generation)),
      );
  }
}
