import { Schema } from "@antelopejs/interface-database";
import type { WriteValue } from "@antelopejs/interface-database/common";

export const DAY_MS = 86_400_000;

/** A document the demo writes as is, to any of the module's tables. */
export type Row = { _id: string } & Record<string, WriteValue>;

export function table(schema: string, name: string, instance?: string) {
  const found = Schema.get<Record<string, Row>>(schema)
    ?.instance(instance)
    .table(name);
  if (!found) {
    throw new Error(`[playground] table ${name} is not registered`);
  }
  return found;
}

/** Deterministic: the same dataset on every fresh database. */
export function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function utcMidnight(time: number): number {
  const date = new Date(time);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
