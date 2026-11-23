import type {
  MarketingExperiment,
  MarketingExperimentRun,
  MarketingExperimentStatus,
} from './useMarketingApi'
import { isRecord, isString } from '../utils/guards'

/**
 * The A/B facet of a funnel as it travels through the form layer.
 *
 * The value reaches components either as the real object or as a JSON string —
 * the input and the list display both have to read the two shapes, so the
 * parse lives once here. Invalid input answers null (or an empty list), never
 * a throw: this runs while rendering a cell.
 */
export interface ExperimentVariationDraft {
  key: string
  weight: number
}

export interface ExperimentDraft {
  key: string
  status?: MarketingExperimentStatus
  variations: ExperimentVariationDraft[]
  /** Read-only here: the pane reads how many runs the split has had, the
   * form carries them back untouched and the backend re-derives them. */
  runs: MarketingExperimentRun[]
}

function isVariation(value: unknown): value is ExperimentVariationDraft {
  return (
    isRecord(value) && isString(value.key) && typeof value.weight === 'number'
  )
}

function isRun(value: unknown): value is MarketingExperimentRun {
  return (
    isRecord(value) &&
    typeof value.startedAt === 'number' &&
    (value.stoppedAt === null || typeof value.stoppedAt === 'number')
  )
}

/** Whether `value` is an experiment as the backend stores it. */
export function isExperiment(value: unknown): value is MarketingExperiment {
  return (
    isRecord(value) &&
    isString(value.key) &&
    isStatus(value.status) &&
    Array.isArray(value.variations) &&
    value.variations.every(isVariation) &&
    Array.isArray(value.runs) &&
    value.runs.every(isRun)
  )
}

function isStatus(value: unknown): value is MarketingExperimentStatus {
  return value === 'draft' || value === 'running' || value === 'stopped'
}

function variationsOf(parsed: unknown): ExperimentVariationDraft[] {
  return Array.isArray(parsed) ? parsed.filter(isVariation) : []
}

function experimentOf(parsed: unknown): ExperimentDraft | null {
  if (isRecord(parsed)) {
    return {
      key: isString(parsed.key) ? parsed.key : '',
      status: isStatus(parsed.status) ? parsed.status : undefined,
      variations: variationsOf(parsed.variations),
      runs: Array.isArray(parsed.runs) ? parsed.runs.filter(isRun) : [],
    }
  }
  return null
}

function variationsFromJson(raw: string): ExperimentVariationDraft[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return variationsOf(parsed)
  } catch {
    return []
  }
}

function experimentFromJson(raw: string): ExperimentDraft | null {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return experimentOf(parsed)
  } catch {
    return null
  }
}

export function parseExperimentVariationsValue(
  raw: unknown,
): ExperimentVariationDraft[] {
  if (isString(raw)) {
    return variationsFromJson(raw)
  }
  if (Array.isArray(raw)) {
    return variationsOf(raw)
  }
  return []
}

export function parseExperimentValue(raw: unknown): ExperimentDraft | null {
  if (isString(raw)) {
    return experimentFromJson(raw)
  }
  if (isRecord(raw)) {
    return experimentOf(raw)
  }
  return null
}
