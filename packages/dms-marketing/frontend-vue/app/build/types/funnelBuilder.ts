import type { StepValue } from '../../utils/funnel-draft'

/** A step row of `FunnelBuilder`: the step and the key its row renders under. */
export interface StepDraft extends StepValue {
  uid: number
}

/** A variation row of `FunnelBuilder`, its weight as typed. */
export interface VariationDraft {
  uid: number
  key: string
  weight: number | string
}
