/**
 * Funnel steps as they travel through the form layer.
 *
 * The value reaches components either as the real array or as a JSON string —
 * the input and the table display both have to read the two shapes, so the
 * parse lives once here. Invalid input answers an empty list, never a throw:
 * this runs while rendering a cell.
 *
 * @packageDocumentation
 */
import { isRecord, isString } from '../utils/guards'

export interface FunnelStepDraft {
  kind: 'url' | 'custom'
  value: string
}

/** The two shapes a steps value takes on its way to a component. */
export type FunnelStepsValue = FunnelStepDraft[] | string | null | undefined

function isFunnelStepDraft(value: unknown): value is FunnelStepDraft {
  return (
    isRecord(value) &&
    (value.kind === 'url' || value.kind === 'custom') &&
    isString(value.value)
  )
}

function isStepList(value: unknown): value is FunnelStepDraft[] {
  return Array.isArray(value) && value.every(isFunnelStepDraft)
}

/** Whether a value a table hands over is one of the shapes of a steps value. */
export function isFunnelStepsValue(value: unknown): value is FunnelStepsValue {
  return (
    value === null ||
    value === undefined ||
    isString(value) ||
    isStepList(value)
  )
}

function decodeSteps(raw: string): FunnelStepDraft[] {
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isFunnelStepDraft) : []
  } catch {
    return []
  }
}

export function parseFunnelStepsValue(raw: unknown): FunnelStepDraft[] {
  if (isString(raw)) {
    return decodeSteps(raw)
  }
  return isStepList(raw) ? raw : []
}
