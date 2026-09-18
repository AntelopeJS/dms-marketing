import type { FunnelExperiment } from "@/db/tables/funnels.table";
import type { MarketingEvent } from "@/db/tables/marketing_events.table";
import {
  computeFunnelOverSessions,
  type FunnelComputation,
  type FunnelDefinition,
  type FunnelEvent,
  groupBySession,
} from "@/services/funnels/compute";
import type { ExposureEventData } from "@/types";
import { normalizedWeights } from "./assign";
import { type SrmCheck, sampleRatioCheck, twoProportionTest } from "./stats";

export interface VariationResult {
  key: string;
  /** The arm's denominator: sessions exposed to it, converted or not. */
  exposedSessions: number;
  computation: FunnelComputation;
  /** Last step over exposedSessions — entering the funnel is an outcome the
   * variation influences, so the funnel's own entered-based rates are not
   * comparable across arms. */
  conversionRate: number;
  /** Relative to the control's conversion; null on the control itself. */
  uplift: number | null;
  pValue: number | null;
  significant: boolean | null;
}

export interface ExperimentResults {
  control: string;
  variations: VariationResult[];
  srm: SrmCheck;
}

/** The funnel fields plus `data`, where an exposure carries its variation. */
export type ResultEvent = FunnelEvent & Pick<MarketingEvent, "data">;

/** Sentinel for sessions seen under two variations (salt rotation, edits):
 * excluded from every arm rather than counted twice. */
const MIXED = null;

function variationBySession(
  events: ResultEvent[],
  experiment: FunnelExperiment,
): Map<string, string | null> {
  const armKeys = new Set(experiment.variations.map((v) => v.key));
  const assignments = new Map<string, string | null>();
  for (const event of events) {
    if (event.kind !== "exposure" || event.name !== experiment.key) {
      continue;
    }
    const variation = (event.data as Partial<ExposureEventData> | undefined)
      ?.variation;
    if (typeof variation !== "string" || !armKeys.has(variation)) {
      continue;
    }
    const existing = assignments.get(event.sessionId);
    if (existing === undefined) {
      assignments.set(event.sessionId, variation);
    } else if (existing !== MIXED && existing !== variation) {
      assignments.set(event.sessionId, MIXED);
    }
  }
  return assignments;
}

/**
 * Variation breakdown of one event window: sessions mapped to arms by their
 * exposure events — the recorded exposure is the authority, never a
 * re-derived assignment — then the funnel counting core per arm. Verdicts
 * are withheld on a truncated window.
 *
 * Every exposure handed in counts. Bounding them to the split's run is the
 * loader's job (services/funnels/results), which owns the dates.
 */
export function computeExperimentResults(
  events: ResultEvent[],
  goal: FunnelDefinition,
  experiment: FunnelExperiment,
  truncated: boolean,
): ExperimentResults {
  const assignments = variationBySession(events, experiment);

  const funnelEventsByArm = new Map<string, ResultEvent[]>();
  for (const event of events) {
    if (event.kind === "exposure") {
      continue;
    }
    const arm = assignments.get(event.sessionId);
    if (arm === undefined || arm === MIXED) {
      continue;
    }
    const bucket = funnelEventsByArm.get(arm);
    if (bucket) {
      bucket.push(event);
    } else {
      funnelEventsByArm.set(arm, [event]);
    }
  }

  const exposedByArm = new Map<string, number>();
  for (const arm of assignments.values()) {
    if (arm !== MIXED) {
      exposedByArm.set(arm, (exposedByArm.get(arm) ?? 0) + 1);
    }
  }

  interface ArmCount {
    key: string;
    exposed: number;
    conversions: number;
    computation: FunnelComputation;
  }

  const counts: ArmCount[] = experiment.variations.map((variation) => {
    const computation = computeFunnelOverSessions(
      goal,
      groupBySession(funnelEventsByArm.get(variation.key) ?? []).values(),
    );
    const lastStep = computation.steps[computation.steps.length - 1];
    return {
      key: variation.key,
      exposed: exposedByArm.get(variation.key) ?? 0,
      conversions: lastStep?.sessions ?? 0,
      computation,
    };
  });

  const control = counts[0];
  const controlRate =
    control.exposed > 0 ? control.conversions / control.exposed : 0;

  const variations: VariationResult[] = counts.map((arm, index) => {
    const rate = arm.exposed > 0 ? arm.conversions / arm.exposed : 0;
    const isControl = index === 0;
    const test =
      isControl || truncated
        ? { pValue: null, significant: null }
        : twoProportionTest(
            control.conversions,
            control.exposed,
            arm.conversions,
            arm.exposed,
          );
    return {
      key: arm.key,
      exposedSessions: arm.exposed,
      computation: arm.computation,
      conversionRate: rate,
      uplift:
        isControl || controlRate === 0
          ? null
          : (rate - controlRate) / controlRate,
      pValue: test.pValue,
      significant: test.significant,
    };
  });

  return {
    control: control.key,
    variations,
    srm: sampleRatioCheck(
      counts.map((arm) => arm.exposed),
      normalizedWeights(experiment.variations),
    ),
  };
}
