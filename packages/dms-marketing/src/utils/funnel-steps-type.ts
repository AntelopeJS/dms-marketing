import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import {
  DataType,
  RegisterDataType,
} from "@antelopejs/interface-dms/base/data-types";
import { z } from "zod";
import { normalizeStepPath } from "@/services/funnels/step-path";
import {
  MAX_FUNNEL_STEP_VALUE_LENGTH,
  MAX_FUNNEL_STEPS,
  MIN_FUNNEL_STEPS,
} from "@/types/constants";
import { isString } from "@/utils/guards";

/** A page step is stored as the path the collector records: a pasted URL,
 * query string or trailing slash would otherwise match nothing. */
const stepSchema = z
  .object({
    kind: z.enum(["url", "custom"]),
    value: z.string().trim().min(1).max(MAX_FUNNEL_STEP_VALUE_LENGTH),
  })
  .transform((step) =>
    step.kind === "url"
      ? { ...step, value: normalizeStepPath(step.value) }
      : step,
  );

/**
 * Direct API callers may send a JSON string; accept both string and array,
 * and normalize to the validated array, throwing on invalid input. The
 * data-api Validator only checks validity and keeps the RAW body value, so
 * the new/edit wrappers must parse with this before the write or a string
 * would be persisted as-is.
 */
export const funnelStepsSchema = z
  .union([z.string(), z.array(stepSchema)])
  .transform((value) => {
    if (!isString(value)) {
      return value;
    }
    if (value === "") {
      return [];
    }
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed;
    } catch {
      return [];
    }
  })
  .pipe(z.array(stepSchema).min(MIN_FUNNEL_STEPS).max(MAX_FUNNEL_STEPS));

/**
 * Ordered funnel steps as a form field — an array of {kind, value} objects
 * no built-in DataType models.
 */
@RegisterDataType("marketing_funnel_steps")
export class FunnelStepsType extends DataType {
  constructor(options: DataType["options"] = {}) {
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
