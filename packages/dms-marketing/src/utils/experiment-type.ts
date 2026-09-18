import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import {
  DataType,
  RegisterDataType,
} from "@antelopejs/interface-dms/base/data-types";
import { z } from "zod";
import { EXPERIMENT_STATUSES } from "@/db/tables/funnels.table";
import {
  MAX_EXPERIMENT_KEY_LENGTH,
  MAX_EXPERIMENT_VARIATIONS,
  MIN_EXPERIMENT_VARIATIONS,
} from "@/types/constants";

/** Slug shape shared by experiment and variation keys — what page code types
 * into `dmsMarketing.variation(…)`, so no spaces and no case to get wrong. */
const experimentKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_EXPERIMENT_KEY_LENGTH)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);

const variationSchema = z.object({
  key: experimentKeySchema,
  weight: z.number().finite().nonnegative(),
});

const variationsSchema = z
  .array(variationSchema)
  .min(MIN_EXPERIMENT_VARIATIONS)
  .max(MAX_EXPERIMENT_VARIATIONS)
  .refine(
    (variations) =>
      new Set(variations.map((v) => v.key)).size === variations.length,
  )
  // All-zero weights would make normalization fall back to uniform
  // silently; refuse them instead so the form says why.
  .refine((variations) => variations.some((v) => v.weight > 0));

/** `status` is the transition the caller asks for; absent keeps the row's. */
const experimentSchema = z.object({
  key: experimentKeySchema,
  status: z.enum(EXPERIMENT_STATUSES).optional(),
  variations: variationsSchema,
});

export type ExperimentInput = z.output<typeof experimentSchema>;

function isBlankKey(value: unknown): boolean {
  return typeof value !== "string" || value.trim() === "";
}

/**
 * Normalizes a body-provided experiment (object, JSON string, or nothing)
 * into the validated shape — null for "no experiment", which the form sends
 * as a blank key with no arms. Throws (ZodError or SyntaxError) on invalid
 * input; the data-api Validator only checks validity and keeps the RAW body
 * value, so the write wrappers must run this before the write.
 */
export function parseExperimentInput(raw: unknown): ExperimentInput | null {
  const value = typeof raw === "string" && raw !== "" ? JSON.parse(raw) : raw;
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const candidate = value as Partial<ExperimentInput>;
  const noArms =
    !Array.isArray(candidate.variations) || candidate.variations.length === 0;
  if (isBlankKey(candidate.key) && noArms) {
    return null;
  }
  return experimentSchema.parse(value);
}

/** Which part of the input a parse failure names, for the error message. */
export function experimentIssueField(
  error: unknown,
): "key" | "variations" | "status" | undefined {
  if (!(error instanceof z.ZodError)) {
    return undefined;
  }
  const field = error.issues[0]?.path[0];
  return field === "key" || field === "variations" || field === "status"
    ? field
    : undefined;
}

const experimentValueSchema = z.unknown().refine((value) => {
  try {
    parseExperimentInput(value);
    return true;
  } catch {
    return false;
  }
});

/**
 * The A/B facet of a funnel as a form field — key, weighted arms and the
 * lifecycle status no built-in DataType models. Off (null) by default.
 */
@RegisterDataType("marketing_experiment")
export class ExperimentType extends DataType {
  constructor(public readonly options: Record<string, unknown> = {}) {
    super([], undefined, options);
  }

  protected defaultInputComponent() {
    return CustomComponent("DmsMarketingExperimentInput")
      .options(this.options)
      .serializeSync();
  }

  getValidation() {
    return experimentValueSchema;
  }
}
