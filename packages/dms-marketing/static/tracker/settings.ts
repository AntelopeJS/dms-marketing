import { isFiniteNumber, isRecord } from "../shared/guards";

const DEFAULT_SAMPLE_RATE = 0.1;

/** The module settings the tracker route injects. */
export interface ServedConfig {
  /** Collection is paused in Settings: the page API without the collection. */
  readonly paused: boolean;
  readonly heatmapSampleRate: number | undefined;
}

/** Read once and removed: the injected settings are not a page-facing API. */
export function servedConfig(): ServedConfig {
  const injected = window.__dmsMarketingTrackerConfig;
  delete window.__dmsMarketingTrackerConfig;
  if (!isRecord(injected)) {
    return { paused: false, heatmapSampleRate: undefined };
  }
  return {
    paused: injected.paused === true,
    heatmapSampleRate: isFiniteNumber(injected.heatmapSampleRate)
      ? injected.heatmapSampleRate
      : undefined,
  };
}

/** Embed attribute wins over the module setting, which wins over the default. */
export function resolveSampleRate(
  attribute: string | null,
  served: ServedConfig,
): number {
  const fromAttribute =
    attribute === null ? Number.NaN : Number.parseFloat(attribute);
  const rate = Number.isFinite(fromAttribute)
    ? fromAttribute
    : (served.heatmapSampleRate ?? DEFAULT_SAMPLE_RATE);
  return Math.min(Math.max(rate, 0), 1);
}
