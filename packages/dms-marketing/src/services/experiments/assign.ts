import { createHash } from "node:crypto";
import type {
  ExperimentVariation,
  Funnel,
  FunnelExperiment,
} from "@/db/tables/funnels.table";
import { ASSIGNMENT_HASH_HEX_CHARS } from "@/types/constants";

/** What the public script serves: experiment key → assigned variation key. */
export type AssignmentMap = Record<string, string>;

/** Relative weights → proportions; non-positive totals fall back to uniform. */
export function normalizedWeights(variations: ExperimentVariation[]): number[] {
  const total = variations.reduce((sum, v) => sum + Math.max(v.weight, 0), 0);
  if (total <= 0) {
    return variations.map(() => 1 / variations.length);
  }
  return variations.map((v) => Math.max(v.weight, 0) / total);
}

/**
 * Deterministic bucket in [0, 1). Salting the hash with the experiment key
 * is what decorrelates experiments: without it, two experiments with the
 * same weights would put every visitor on the same arm index in both.
 */
function bucketOf(visitorId: string, experimentKey: string): number {
  const hex = createHash("sha256")
    .update(`${visitorId}:${experimentKey}`)
    .digest("hex")
    .slice(0, ASSIGNMENT_HASH_HEX_CHARS);
  const bits = ASSIGNMENT_HASH_HEX_CHARS * 4;
  return Number.parseInt(hex, 16) / 2 ** bits;
}

/** Pure function of (visitor, experiment): no clock, no DB, no state. */
export function assignVariation(
  visitorId: string,
  experiment: FunnelExperiment,
): string | undefined {
  if (experiment.variations.length === 0) {
    return undefined;
  }
  const bucket = bucketOf(visitorId, experiment.key);
  const weights = normalizedWeights(experiment.variations);
  let cumulative = 0;
  for (let i = 0; i < experiment.variations.length; i++) {
    cumulative += weights[i];
    if (bucket < cumulative) {
      return experiment.variations[i].key;
    }
  }
  // Floating-point sums can land a hair under 1; the last arm absorbs it.
  return experiment.variations[experiment.variations.length - 1].key;
}

export function assignAll(visitorId: string, funnels: Funnel[]): AssignmentMap {
  const assignments: AssignmentMap = {};
  for (const funnel of funnels) {
    const experiment = funnel.experiment;
    if (!experiment) {
      continue;
    }
    const variation = assignVariation(visitorId, experiment);
    if (variation !== undefined) {
      assignments[experiment.key] = variation;
    }
  }
  return assignments;
}
