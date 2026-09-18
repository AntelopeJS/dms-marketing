import {
  Controller,
  HTTPResult,
  type RequestContext,
} from "@antelopejs/interface-api";
import {
  DataController,
  type DataControllerCallback,
  RegisterDataController,
} from "@antelopejs/interface-data-api";
import type { Parameters } from "@antelopejs/interface-data-api/components";
import {
  Access,
  AccessMode,
  Listable,
  Mandatory,
  ModelReference,
  Sortable,
} from "@antelopejs/interface-data-api/metadata";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import {
  Column,
  Exported,
  Searchable,
  Select,
  TableViewRoutes,
} from "@antelopejs/interface-dms/base";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { TenantScopedModel } from "@antelopejs/interface-dms/tenant-scoped-model";
import { FunnelsModel } from "@/db";
import {
  type ExperimentRun,
  type ExperimentStatus,
  Funnel,
  type FunnelExperiment,
  type FunnelStep,
} from "@/db/tables/funnels.table";
import { invalidateExperimentDefinitions } from "@/services/experiment-definitions";
import { requireTenantWebsite } from "@/services/tenant-website";
import {
  API_BASE_PATH,
  DEFAULT_CONVERSION_WINDOW_HOURS,
  HTTP_BAD_REQUEST,
  MAX_CONVERSION_WINDOW_HOURS,
  MAX_NAME_LENGTH,
  MS_PER_HOUR,
} from "@/types/constants";
import {
  type ExperimentInput,
  ExperimentType,
  experimentIssueField,
  parseExperimentInput,
} from "@/utils/experiment-type";
import { FunnelStepsType, parseFunnelSteps } from "@/utils/funnel-steps-type";
import { parseBody } from "./body";
import { HiddenStringFilter } from "./hidden-filter";
import { websitesDataAPI } from "./websites";

const INVALID_STEPS_MESSAGE = "$page.marketing.errors.invalid_steps";
const INVALID_VARIATIONS_MESSAGE = "$page.marketing.errors.invalid_variations";
const INVALID_KEY_MESSAGE = "$page.marketing.errors.invalid_experiment_key";
const DUPLICATE_KEY_MESSAGE = "$page.marketing.errors.duplicate_experiment_key";
const LOCKED_MESSAGE = "$page.marketing.errors.experiment_locked";
const INVALID_TRANSITION_MESSAGE =
  "$page.marketing.errors.invalid_status_transition";
const NOT_FOUND_MESSAGE = "$page.marketing.errors.funnel_not_found";

/**
 * Reachable targets per current status; staying put is always legal. Stopped
 * goes back to running — the arms and their weights stay frozen, so a resumed
 * split buckets visitors exactly as it did before and its runs simply add up.
 * Nothing returns to draft: that would unfreeze the arms under exposures
 * already recorded against them.
 */
const STATUS_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  draft: ["draft", "running"],
  running: ["running", "stopped"],
  stopped: ["stopped", "running"],
};

const EXPERIMENT_ISSUE_MESSAGES = {
  key: INVALID_KEY_MESSAGE,
  variations: INVALID_VARIATIONS_MESSAGE,
  status: INVALID_TRANSITION_MESSAGE,
};

function badRequest(message: string): HTTPResult {
  return new HTTPResult(HTTP_BAD_REQUEST, message);
}

function tenantFunnels(ctx: RequestContext): FunnelsModel {
  return GetModel(FunnelsModel, getRequestTenantId(ctx));
}

/**
 * The data-api Validator only CHECKS the field and persists the raw body
 * value, so a JSON-string steps payload would be stored as a string;
 * normalize it to the validated array before the write.
 */
function normalizeSteps(parsed: Record<string, unknown>): void {
  if (parsed.steps === undefined) {
    return;
  }
  try {
    parsed.steps = parseFunnelSteps(parsed.steps);
  } catch {
    throw badRequest(INVALID_STEPS_MESSAGE);
  }
}

function parseExperiment(
  parsed: Record<string, unknown>,
): ExperimentInput | null {
  try {
    return parseExperimentInput(parsed.experiment);
  } catch (error) {
    const field = experimentIssueField(error);
    throw badRequest(
      field ? EXPERIMENT_ISSUE_MESSAGES[field] : INVALID_VARIATIONS_MESSAGE,
    );
  }
}

function assertTransition(
  current: ExperimentStatus,
  next: ExperimentStatus,
): void {
  if (!STATUS_TRANSITIONS[current].includes(next)) {
    throw badRequest(INVALID_TRANSITION_MESSAGE);
  }
}

/**
 * The runs a row carries once it has been through the transition. They are
 * the bounds the results are later read over, so they are derived here and
 * never taken from the body — a caller-provided run would re-open the window
 * of a split it can no longer be assigned into. Starting appends a run,
 * stopping closes the open one, and standing still changes nothing.
 */
function lifecycleRuns(
  existing: FunnelExperiment | null,
  from: ExperimentStatus,
  to: ExperimentStatus,
): ExperimentRun[] {
  const runs: ExperimentRun[] = existing?.runs.map((run) => ({ ...run })) ?? [];
  if (from === to) {
    return runs;
  }
  const open = runs[runs.length - 1];
  if (to === "running") {
    runs.push({ startedAt: Date.now(), stoppedAt: null });
  } else if (to === "stopped" && open && open.stoppedAt === null) {
    open.stoppedAt = Date.now();
  }
  return runs;
}

/**
 * The experiment a write may store, given the row it replaces. Outside
 * draft, `key`, `websiteId`, `variations` and the experiment's very
 * existence are frozen: editing weights or keys mid-run moves the bucket
 * boundaries and silently reassigns visitors, and the recorded exposures
 * would mix two histories. The status moves through assertTransition; an
 * experiment added to a plain funnel starts wherever draft may go.
 */
function resolveExperiment(
  requested: ExperimentInput | null,
  current: Funnel | undefined,
  websiteId: string,
): FunnelExperiment | null {
  const existing = current?.experiment ?? null;
  if (existing && existing.status !== "draft") {
    const unchanged =
      requested !== null &&
      requested.key === existing.key &&
      JSON.stringify(requested.variations) ===
        JSON.stringify(existing.variations) &&
      websiteId === current?.websiteId;
    if (!unchanged) {
      throw badRequest(LOCKED_MESSAGE);
    }
  }
  if (requested === null) {
    return null;
  }
  const currentStatus = existing?.status ?? "draft";
  const status = requested.status ?? currentStatus;
  assertTransition(currentStatus, status);
  return {
    key: requested.key,
    status,
    variations: requested.variations,
    runs: lifecycleRuns(existing, currentStatus, status),
  };
}

async function assertUniqueKey(
  ctx: RequestContext,
  websiteId: string,
  key: string,
  excludeId?: string,
): Promise<void> {
  if (await tenantFunnels(ctx).hasKey(websiteId, key, excludeId)) {
    throw badRequest(DUPLICATE_KEY_MESSAGE);
  }
}

type WriteFunc = (
  this: unknown,
  ctx: RequestContext,
  params: Parameters.EditParameters,
  body: Buffer | string,
  ...rest: unknown[]
) => Promise<unknown>;

function forwardWrite(
  base: DataControllerCallback,
  func: WriteFunc,
): DataControllerCallback {
  return { ...base, func };
}

/**
 * The rules structural tenant isolation cannot carry: `websiteId` points at
 * the GLOBAL websites table, so the target site must belong to the caller's
 * tenant, plus the steps and experiment normalization above.
 */
function withNewChecks(base: DataControllerCallback): DataControllerCallback {
  return forwardWrite(base, async function (ctx, params, body, ...rest) {
    const parsed = parseBody(body);
    const websiteId =
      typeof parsed.websiteId === "string" ? parsed.websiteId : undefined;
    await requireTenantWebsite(ctx, websiteId);
    normalizeSteps(parsed);
    const experiment = resolveExperiment(
      parseExperiment(parsed),
      undefined,
      websiteId as string,
    );
    if (experiment) {
      await assertUniqueKey(ctx, websiteId as string, experiment.key);
    }
    parsed.experiment = experiment;
    const result = await base.func.call(
      this,
      ctx,
      params,
      Buffer.from(JSON.stringify(parsed)),
      ...rest,
    );
    invalidateExperimentDefinitions(websiteId as string);
    return result;
  });
}

function withEditChecks(base: DataControllerCallback): DataControllerCallback {
  return forwardWrite(base, async function (ctx, params, body, ...rest) {
    const parsed = parseBody(body);
    const current = await tenantFunnels(ctx).get(params.id);
    if (!current) {
      throw badRequest(NOT_FOUND_MESSAGE);
    }
    if (typeof parsed.websiteId === "string") {
      await requireTenantWebsite(ctx, parsed.websiteId);
    }
    normalizeSteps(parsed);
    const websiteId =
      typeof parsed.websiteId === "string"
        ? parsed.websiteId
        : current.websiteId;
    const experiment = resolveExperiment(
      parseExperiment(parsed),
      current,
      websiteId,
    );
    if (experiment) {
      await assertUniqueKey(ctx, websiteId, experiment.key, current._id);
    }
    parsed.experiment = experiment;
    const result = await base.func.call(
      this,
      ctx,
      params,
      Buffer.from(JSON.stringify(parsed)),
      ...rest,
    );
    // Both sites when a draft moves: neither may keep serving stale sets.
    invalidateExperimentDefinitions(websiteId);
    if (current.websiteId !== websiteId) {
      invalidateExperimentDefinitions(current.websiteId);
    }
    return result;
  });
}

/** Deleting a running experiment is allowed — pages fall back to the control
 * within the definitions TTL — but the cache must not outlive the row. */
function withDeleteInvalidation(
  base: DataControllerCallback,
): DataControllerCallback {
  return {
    ...base,
    func: async function (
      this: unknown,
      ctx: RequestContext,
      params: Parameters.DeleteParameters,
      ...rest: unknown[]
    ) {
      // Read the sites BEFORE the delete — after it there is nothing left to
      // resolve them from.
      const websiteIds = await tenantFunnels(ctx).listWebsiteIdsOf(params.id);
      const result = await base.func.call(this, ctx, params, ...rest);
      for (const websiteId of websiteIds) {
        invalidateExperimentDefinitions(websiteId);
      }
      return result;
    },
  };
}

const funnelsRoutes = {
  ...TableViewRoutes.All,
  new: withNewChecks(TableViewRoutes.New),
  edit: withEditChecks(TableViewRoutes.Edit),
  delete: withDeleteInvalidation(TableViewRoutes.Delete),
};

@RegisterDataController()
@AuthOwnerOnly()
export class funnelsDataAPI extends DataController(
  Funnel,
  funnelsRoutes,
  Controller(`${API_BASE_PATH}/tables/funnels`),
) {
  @ModelReference()
  @TenantScopedModel(FunnelsModel)
  declare model: FunnelsModel;

  @Select()
  @Listable()
  @Exported()
  @Access(AccessMode.ReadOnly)
  declare _id: string;

  @Select()
  @Listable()
  @HiddenStringFilter()
  @Mandatory("new", "edit")
  @Column({
    name: "$page.marketing.funnels.column.website",
    type: new DefaultDataTypes.RelationType({
      dataApiController: websitesDataAPI,
      keyMapping: { label: "name", value: "_id" },
    }),
  })
  @Access(AccessMode.ReadWrite)
  declare websiteId: string;

  @Select()
  @Listable()
  @Searchable()
  @Sortable()
  @Exported()
  @Mandatory("new", "edit")
  @Column({
    name: "$page.marketing.funnels.column.name",
    type: new DefaultDataTypes.StringType({
      maxLength: MAX_NAME_LENGTH,
      placeholder: "$page.marketing.funnels.form.name",
    }),
  })
  @Access(AccessMode.ReadWrite)
  declare name: string;

  // Listable so the definitions list can label rows with their step count
  // (and edit in place) without one extra get per row.
  @Select()
  @Listable()
  @Mandatory("new", "edit")
  @Column({
    name: "$page.marketing.funnels.form.steps",
    description: "$page.marketing.funnels.form.steps_description",
    type: new FunnelStepsType(),
  })
  @Access(AccessMode.ReadWrite)
  declare steps: FunnelStep[];

  @Select(["conversionWindowMs"])
  @Listable(["conversionWindowMs"])
  @Column({
    name: "$page.marketing.funnels.form.window",
    type: new DefaultDataTypes.NumberType({
      min: 1,
      max: MAX_CONVERSION_WINDOW_HOURS,
    }),
    defaultValue: DEFAULT_CONVERSION_WINDOW_HOURS,
  })
  @Access(AccessMode.ReadWrite)
  get conversionWindowHours(): number {
    // `this` is the decorated data-api row instance, whose backing table
    // the generated type does not expose.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions
    const row = (this as unknown as { table: Funnel }).table;
    return Math.round(row.conversionWindowMs / MS_PER_HOUR);
  }
  // The write path calls every writable setter whether the key is in
  // the body: an absent/null field must never yield NaN or 0 — keep the
  // row's current window (edit), or fall back to the default (new).
  set conversionWindowHours(hours: number) {
    // `this` is the decorated data-api row instance, whose backing table
    // the generated type does not expose.
    // oxlint-disable-next-line anti-slop/no-chained-type-assertions
    const row = (this as unknown as { table: Funnel }).table;
    if (typeof hours === "number" && Number.isFinite(hours) && hours >= 1) {
      row.conversionWindowMs = hours * MS_PER_HOUR;
      return;
    }
    row.conversionWindowMs ||= DEFAULT_CONVERSION_WINDOW_HOURS * MS_PER_HOUR;
  }

  // Listable so the list can show the status and arm count of split rows
  // without one extra get per row.
  @Select()
  @Listable()
  @Column({
    name: "$page.marketing.funnels.form.experiment",
    description: "$page.marketing.funnels.form.experiment_description",
    type: new ExperimentType(),
  })
  @Access(AccessMode.ReadWrite)
  declare experiment: FunnelExperiment | null;

  @Select()
  @Listable()
  @Sortable()
  @Exported()
  @Column({
    name: "$page.marketing.funnels.column.created",
    type: new DefaultDataTypes.DateType(),
  })
  @Access(AccessMode.ReadOnly)
  declare createdAt: Date;
}
