import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import {
  DataType,
  RegisterDataType,
} from "@antelopejs/interface-dms/base/data-types";
import { z } from "zod";
import {
  MAX_FUNNEL_STEP_VALUE_LENGTH,
  MAX_FUNNEL_STEPS,
  MIN_FUNNEL_STEPS,
} from "@/types/constants";

const stepSchema = z.object({
  kind: z.enum(["url", "custom"]),
  value: z.string().trim().min(1).max(MAX_FUNNEL_STEP_VALUE_LENGTH),
});

/** Direct API callers may send a JSON string; accept both string and array. */
const funnelStepsSchema = z
  .union([z.string(), z.array(stepSchema)])
  .transform((value) => {
    if (typeof value !== "string") {
      return value;
    }
    if (value === "") {
      return [];
    }
    try {
      return JSON.parse(value);
    } catch {
      return [];
    }
  })
  .pipe(z.array(stepSchema).min(MIN_FUNNEL_STEPS).max(MAX_FUNNEL_STEPS));

export type FunnelStepInput = z.output<typeof stepSchema>;

/**
 * Normalizes a body-provided steps value (array or JSON string) into the
 * validated array, throwing on invalid input. The data-api Validator only
 * checks validity and keeps the RAW body value, so the new/edit wrappers must
 * run this before the write or a string would be persisted as-is.
 */
export function parseFunnelSteps(raw: unknown): FunnelStepInput[] {
  return funnelStepsSchema.parse(raw);
}

/**
 * Ordered funnel steps as a form field — an array of {kind, value} objects
 * no built-in DataType models.
 */
@RegisterDataType("marketing_funnel_steps")
export class FunnelStepsType extends DataType {
  constructor(public readonly options: Record<string, unknown> = {}) {
    super([], undefined, options);
  }

  protected defaultInputComponent() {
    return CustomComponent("DmsMarketingFunnelStepsInput")
      .options(this.options)
      .serializeSync();
  }

  getValidation() {
    return funnelStepsSchema;
  }
}
