import type { FunnelExperiment } from "@/db/tables/funnels.table";
import type { MarketingEvent } from "@/db/tables/marketing_events.table";
import {
  computeFunnelOverSessions,
  type FunnelComputation,
  type FunnelDefinition,
  type FunnelEvent,
  groupBySession,
} from "@/services/funnels/compute";
import {
  MIN_DECISION_CONVERSIONS,
  MIN_DECISION_DAYS,
  MS_PER_DAY,
} from "@/types/constants";
import { normalizedWeights } from "./assign";
import {
  comparisonAlpha,
  liftInterval,
  type SrmCheck,
  sampleRatioCheck,
  twoProportionTest,
} from "./stats";
import { isString } from "@/utils/guards";

interface VariationResult {
  key: string;
  /** The arm's denominator: sessions exposed to it, converted or not. */
  exposedSessions: number;
  computation: FunnelComputation;
  /** Last step over exposedSessions — entering the funnel is an outcome the
   * variation influences, so the funnel's own entered-based rates are not
   * comparable across arms. */
  conversionRate: number;
  /** Exposed sessions that reached the goal. */
  conversions: number;
  /** Relative to the control's conversion; null on the control itself. */
  uplift: number | null;
  /** Bounds of `uplift` at the test's level; null wherever the p-value is. */
  upliftLow: number | null;
  upliftHigh: number | null;
  pValue: number | null;
  significant: boolean | null;
}

/** Whether a verdict may be acted on yet, and what it still waits for. */
export interface ExperimentDecision {
  /** Days the split has served traffic, pauses left out. */
  days: number;
  minDays: number;
  minConversions: number;
  /** A full week served and every arm past the conversions floor. */
  ready: boolean;
}

export interface ExperimentResults {
  control: string;
  /** Level each challenger is tested at (Bonferroni past two arms). */
  alpha: number;
  variations: VariationResult[];
  srm: SrmCheck;
  decision: ExperimentDecision;
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
    const variation =
      event.data && "variation" in event.data
        ? event.data.variation
        : undefined;
    if (!isString(variation) || !armKeys.has(variation)) {
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
 * loader's job (services/funnels/results), which owns the dates and hands in
 * how long the split served (`servedMs`) for the decision rule.
 */
export function computeExperimentResults(
  events: ResultEvent[],
  goal: FunnelDefinition,
  experiment: FunnelExperiment,
  truncated: boolean,
  servedMs = 0,
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
  const alpha = comparisonAlpha(counts.length);

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
            alpha,
          );
    const interval =
      test.pValue === null || controlRate === 0
        ? null
        : liftInterval(
            control.conversions,
            control.exposed,
            arm.conversions,
            arm.exposed,
            alpha,
          );
    return {
      key: arm.key,
      exposedSessions: arm.exposed,
      computation: arm.computation,
      conversionRate: rate,
      conversions: arm.conversions,
      uplift:
        isControl || controlRate === 0
          ? null
          : (rate - controlRate) / controlRate,
      upliftLow: interval?.low ?? null,
      upliftHigh: interval?.high ?? null,
      pValue: test.pValue,
      significant: test.significant,
    };
  });

  const days = servedMs / MS_PER_DAY;
  return {
    control: control.key,
    alpha,
    variations,
    decision: {
      days,
      minDays: MIN_DECISION_DAYS,
      minConversions: MIN_DECISION_CONVERSIONS,
      ready:
        days >= MIN_DECISION_DAYS &&
        counts.every((arm) => arm.conversions >= MIN_DECISION_CONVERSIONS),
    },
    srm: sampleRatioCheck(
      counts.map((arm) => arm.exposed),
      normalizedWeights(experiment.variations),
    ),
  };
}
