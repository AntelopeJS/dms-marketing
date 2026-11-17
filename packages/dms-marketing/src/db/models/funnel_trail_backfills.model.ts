import { IsDuplicateKeyError } from "@antelopejs/interface-database";
import { BasicDataModel } from "@antelopejs/interface-database-decorators";
import {
  FunnelTrailBackfill,
  funnelTrailBackfillsTableName,
} from "../tables/funnel_trail_backfills.table";

/**
 * Bumped when what a trail keeps of an event changes (`toStored` in
 * `funnel_trails.model.ts`): every website's coverage then reads `none`, and
 * the next pass deletes the website's trails and walks its events again.
 * Live writes recreate the trails of the sessions they reach meanwhile. A row
 * of a newer version is left to the instances that run it.
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

/**
 * Where a walk of one website starts, and the generation it walks in.
 * `outdated` is a row of an older version: its trails hold entries a walk
 * would skip as held, so they go first (see
 * {@link FunnelTrailBackfillsModel.restart}). `newer` is a row of a newer
 * version, which this instance does not walk.
 */
export type TrailWalkStart =
  | {
      kind: "walk";
      coverage: TrailCoverage;
      generation: number;
      /** See `FunnelTrailBackfill.reconcileStartedAt`. */
      reconcileStartedAt: number | null;
    }
  | { kind: "outdated" }
  | { kind: "newer" };

export class FunnelTrailBackfillsModel extends BasicDataModel(
  FunnelTrailBackfill,
  funnelTrailBackfillsTableName,
) {
  async coverage(websiteId: string): Promise<TrailCoverage> {
    return coverageOf(await this.get(websiteId));
  }

  /**
   * The walk the website's row allows, the row created covering nothing when
   * the website has none.
   */
  async begin(websiteId: string): Promise<TrailWalkStart> {
    const row = await this.get(websiteId);
    if (row && row.version > TRAIL_BACKFILL_VERSION) {
      return { kind: "newer" };
    }
    if (row && row.version < TRAIL_BACKFILL_VERSION) {
      return { kind: "outdated" };
    }
    if (row) {
      return {
        kind: "walk",
        coverage: coverageOf(row),
        generation: row.generation,
        reconcileStartedAt: row.reconcileStartedAt ?? null,
      };
    }
    try {
      await this.table
        .insert({
          _id: websiteId,
          version: TRAIL_BACKFILL_VERSION,
          through: null,
          done: false,
          generation: 0,
          reconcileStartedAt: null,
        })
        .run();
    } catch (error) {
      if (!IsDuplicateKeyError(error)) {
        throw error;
      }
    }
    return {
      kind: "walk",
      coverage: { kind: "none" },
      generation: 0,
      reconcileStartedAt: null,
    };
  }

  /**
   * The trails of an `outdated` website were deleted: its row moves to the
   * current version covering nothing, behind a {@link fence} that stops a
   * walk another instance began on the row meanwhile, and the walk starts
   * from it.
   */
  async restart(websiteId: string): Promise<TrailWalkStart> {
    await this.fence(websiteId);
    await this.table
      .getAll([websiteId])
      .filter((doc) => doc.key("version").le(TRAIL_BACKFILL_VERSION))
      .update({
        version: TRAIL_BACKFILL_VERSION,
        through: null,
        done: false,
        reconcileStartedAt: null,
      })
      .run();
    return this.begin(websiteId);
  }

  /**
   * A website was just created: it has no event yet, so its trails cover
   * everything from the start, with no walk. A row already there is kept.
   */
  async created(websiteId: string): Promise<void> {
    try {
      await this.table
        .insert({
          _id: websiteId,
          version: TRAIL_BACKFILL_VERSION,
          through: null,
          done: true,
          generation: 0,
          reconcileStartedAt: Date.now(),
        })
        .run();
    } catch (error) {
      if (!IsDuplicateKeyError(error)) {
        throw error;
      }
    }
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

  /**
   * A walk of `generation` that started at `startedAt` (epoch ms) went down
   * from the newest event to its floor: the next reconcile walk reaches back
   * to that start.
   */
  async reconciled(
    websiteId: string,
    generation: number,
    startedAt: number,
  ): Promise<void> {
    await this.ofGeneration(websiteId, generation)
      .update({ reconcileStartedAt: startedAt })
      .run();
  }

  /** Claims every event as in the trails: the walk ran out of events. */
  async complete(websiteId: string, generation: number): Promise<void> {
    await this.ofGeneration(websiteId, generation).update({ done: true }).run();
  }

  /**
   * Moves the website's generation, its coverage untouched, before events of
   * the website are deleted: a walk on any instance that read them stops at
   * its next flush, and takes back what a flush in flight wrote (see
   * `services/funnels/trail-backfill`). A website with no row gets one,
   * covering nothing, so a walk that begins meanwhile stops too.
   */
  async fence(websiteId: string): Promise<void> {
    const move = () =>
      this.table
        .get(websiteId)
        .update((doc) => ({ generation: doc.key("generation").add(1) }))
        .run();
    if ((await move()) > 0) {
      return;
    }
    try {
      await this.table
        .insert({
          _id: websiteId,
          version: TRAIL_BACKFILL_VERSION,
          through: null,
          done: false,
          generation: 1,
          reconcileStartedAt: null,
        })
        .run();
    } catch (error) {
      if (!IsDuplicateKeyError(error)) {
        throw error;
      }
      await move();
    }
  }

  /**
   * A purge is deleting every event of the website: its {@link fence}, then
   * everything is covered as of now, since the website is left no event.
   */
  async purged(websiteId: string): Promise<void> {
    await this.fence(websiteId);
    await this.table
      .get(websiteId)
      .update({
        version: TRAIL_BACKFILL_VERSION,
        through: null,
        done: true,
        reconcileStartedAt: Date.now(),
      })
      .run();
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
