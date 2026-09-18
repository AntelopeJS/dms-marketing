import type { Table } from "@antelopejs/interface-database";

interface RetentionRow {
  _id: string;
}

const EPOCH_LOWER_BOUND = new Date(0);

/**
 * Equality of the observed date preserves expiry at this fixed cutoff, even
 * if other fields change. An uncertain delete stops the pass without retry.
 */
export async function deleteExpiredRows<
  F extends string,
  T extends RetentionRow & Record<F, Date>,
>(table: Table<T>, field: F, cutoff: Date): Promise<number> {
  const candidates = (await table
    .between(field, EPOCH_LOWER_BOUND as T[F], cutoff as T[F])
    .pluck("_id", field)
    .run()) as Pick<T, "_id" | F>[];
  let deleted = 0;
  for (const row of candidates) {
    const outcome = await table
      .atomicMutation(row._id, {
        type: "deleteIfEqual",
        field,
        expectedValue: row[field],
      })
      .run();
    if (outcome === "unknown") {
      throw new Error("Retention deletion outcome is unknown");
    }
    deleted += Number(outcome === "applied");
  }
  return deleted;
}
