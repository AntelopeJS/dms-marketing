import {
  EXPERIMENT_SIGNIFICANCE_LEVEL,
  EXPERIMENT_SRM_P_THRESHOLD,
  MIN_OUTCOMES_PER_CELL,
} from "@/types/constants";

/**
 * The inference math, pure and database-free: proportions in, verdicts out.
 * Every "cannot say" answers null rather than a number — a p-value computed
 * outside its approximation's validity is wrong, not approximate.
 */

export interface ProportionTest {
  pValue: number | null;
  significant: boolean | null;
}

export interface SrmCheck {
  expected: number[];
  observed: number[];
  pValue: number | null;
  mismatch: boolean;
}

const NO_VERDICT: ProportionTest = { pValue: null, significant: null };

/** Abramowitz & Stegun 7.1.26 — max error 1.5e-7, far below display needs. */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * abs);
  const poly =
    t *
    (0.254829592 +
      t *
        (-0.284496736 +
          t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - poly * Math.exp(-abs * abs));
}

function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

/**
 * Pooled two-proportion z-test, two-sided: does the variant's conversion
 * differ from the control's? Answers no verdict when any cell (successes or
 * failures, either arm) is thinner than the normal approximation tolerates.
 */
export function twoProportionTest(
  controlConversions: number,
  controlTotal: number,
  variantConversions: number,
  variantTotal: number,
): ProportionTest {
  const cells = [
    controlConversions,
    controlTotal - controlConversions,
    variantConversions,
    variantTotal - variantConversions,
  ];
  if (cells.some((count) => count < MIN_OUTCOMES_PER_CELL)) {
    return NO_VERDICT;
  }
  const pooled =
    (controlConversions + variantConversions) / (controlTotal + variantTotal);
  const standardError = Math.sqrt(
    pooled * (1 - pooled) * (1 / controlTotal + 1 / variantTotal),
  );
  if (standardError === 0) {
    return NO_VERDICT;
  }
  const z =
    (variantConversions / variantTotal - controlConversions / controlTotal) /
    standardError;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));
  return { pValue, significant: pValue < EXPERIMENT_SIGNIFICANCE_LEVEL };
}

/** Wilson–Hilferty: a chi-square tail through the normal — coarse in the
 * far tail, and this only gates a warning, never a success claim. */
function chiSquareTail(chi2: number, degreesOfFreedom: number): number {
  const scaled = chi2 / degreesOfFreedom;
  const mean = 1 - 2 / (9 * degreesOfFreedom);
  const deviation = Math.sqrt(2 / (9 * degreesOfFreedom));
  return 1 - normalCdf((Math.cbrt(scaled) - mean) / deviation);
}

/**
 * Sample-ratio-mismatch check: chi-square goodness of fit of the observed
 * per-arm exposures against the configured proportions. A mismatch means the
 * instrument lies — broken assignment, a bot pinned to one arm, exposures
 * lost on one variant — and every downstream number should be distrusted.
 */
export function sampleRatioCheck(
  observed: number[],
  proportions: number[],
): SrmCheck {
  const total = observed.reduce((sum, count) => sum + count, 0);
  const expected = proportions.map((share) => total * share);
  if (expected.some((count) => count < MIN_OUTCOMES_PER_CELL)) {
    return { expected, observed, pValue: null, mismatch: false };
  }
  const chi2 = observed.reduce(
    (sum, count, i) => sum + (count - expected[i]) ** 2 / expected[i],
    0,
  );
  const pValue = chiSquareTail(chi2, observed.length - 1);
  return {
    expected,
    observed,
    pValue,
    mismatch: pValue < EXPERIMENT_SRM_P_THRESHOLD,
  };
}
