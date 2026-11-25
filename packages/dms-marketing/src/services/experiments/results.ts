import type { TrailEvent } from "@/db/models/funnel_trails.model";
import type { FunnelExperiment } from "@/db/tables/funnels.table";
import {
  type FunnelComputation,
  type FunnelDefinition,
  FunnelTally,
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
interface ExperimentDecision {
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

/** Sentinel for sessions seen under two variations (salt rotation, edits):
 * excluded from every arm rather than counted twice. */
const MIXED = null;

interface ArmTally {
  key: string;
  exposed: number;
  funnel: FunnelTally;
}

interface ArmCount {
  key: string;
  exposed: number;
  conversions: number;
  computation: FunnelComputation;
}

/**
 * The per-arm read of a split, as a fold over sessions: each session is
 * mapped to an arm by its own exposure events (the recorded exposure is the
 * authority, never a re-derived assignment), then counted in that arm's
 * funnel. Holds a tally per arm, nothing per session.
 *
 * Every exposure handed in counts. Bounding them to the split's runs is the
 * loader's job (services/funnels/results), which owns the dates.
 */
export class ExperimentTally {
  readonly #experiment: FunnelExperiment;
  readonly #arms: Map<string, ArmTally>;

  constructor(goal: FunnelDefinition, experiment: FunnelExperiment) {
    this.#experiment = experiment;
    this.#arms = new Map(
      experiment.variations.map((variation) => [
        variation.key,
        { key: variation.key, exposed: 0, funnel: new FunnelTally(goal) },
      ]),
    );
  }

  /** Counts one session, its events in time order. */
  add(events: readonly TrailEvent[]): void {
    const arm = this.#armOf(events);
    if (arm === undefined || arm === MIXED) {
      return;
    }
    const tally = this.#arms.get(arm);
    if (tally) {
      tally.exposed++;
      tally.funnel.add(events.filter((event) => event.kind !== "exposure"));
    }
  }

  #armOf(events: readonly TrailEvent[]): string | typeof MIXED | undefined {
    let arm: string | typeof MIXED | undefined;
    for (const event of events) {
      if (
        event.kind !== "exposure" ||
        event.experiment !== this.#experiment.key ||
        event.variation === null ||
        !this.#arms.has(event.variation)
      ) {
        continue;
      }
      if (arm === undefined) {
        arm = event.variation;
      } else if (arm !== MIXED && arm !== event.variation) {
        arm = MIXED;
      }
    }
    return arm;
  }

  /**
   * Rates, uplifts and tests per arm, the sample ratio check and the
   * decision rule. Tests are withheld on an `incomplete` read: a p-value on a
   * sample missing part of its sessions is wrong, not approximate.
   * `servedMs` is how long the split served traffic.
   */
  result(incomplete: boolean, servedMs: number): ExperimentResults {
    const counts: ArmCount[] = [...this.#arms.values()].map((arm) => {
      const computation = arm.funnel.result();
      return {
        key: arm.key,
        exposed: arm.exposed,
        conversions: computation.steps.at(-1)?.sessions ?? 0,
        computation,
      };
    });
    const control = counts[0];
    const alpha = comparisonAlpha(counts.length);
    const days = servedMs / MS_PER_DAY;
    return {
      control: control.key,
      alpha,
      variations: counts.map((arm, index) =>
        variationResult(arm, control, index === 0 || incomplete, alpha),
      ),
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
        normalizedWeights(this.#experiment.variations),
      ),
    };
  }
}

function variationResult(
  arm: ArmCount,
  control: ArmCount,
  untested: boolean,
  alpha: number,
): VariationResult {
  const controlRate =
    control.exposed > 0 ? control.conversions / control.exposed : 0;
  const rate = arm.exposed > 0 ? arm.conversions / arm.exposed : 0;
  const isControl = arm === control;
  const test = untested
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
}
