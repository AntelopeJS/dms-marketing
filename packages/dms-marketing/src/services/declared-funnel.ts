import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  MarketingDeclarationResult,
  MarketingExperimentDeclaration,
  MarketingFunnelDeclaration,
} from "@antelopejs/interface-dms-marketing";
import { z } from "zod";
import { FunnelsModel, WebsitesModel } from "@/db";
import type {
  ExperimentRun,
  ExperimentStatus,
  FunnelExperiment,
  FunnelStep,
} from "@/db/tables/funnels.table";
import {
  DEFAULT_CONVERSION_WINDOW_HOURS,
  MAX_CONVERSION_WINDOW_HOURS,
  MS_PER_HOUR,
} from "@/types/constants";
import { experimentInputSchema } from "@/utils/experiment-type";
import { funnelStepsSchema } from "@/utils/funnel-steps-type";
import {
  declaredIdSchema,
  declaredTenant,
  describeIssue,
  instantOf,
  MarketingDeclarationError,
  requireDeclaredId,
} from "./declarations";
import { invalidateExperimentDefinitions } from "./experiment-definitions";
import { nameSchema } from "./website-rules";

const OPERATION = "EnsureFunnel";

const windowSchema = z
  .number()
  .finite()
  .min(1)
  .max(MAX_CONVERSION_WINDOW_HOURS)
  .optional();

interface DeclaredExperiment {
  key: string;
  variations: { key: string; weight: number }[];
  status: ExperimentStatus;
}

/** What a declaration sets, normalized. Runs are left out: they follow from
 * the declared status. */
interface FunnelContent {
  websiteId: string;
  name: string;
  steps: FunnelStep[];
  conversionWindowMs: number;
  experiment: DeclaredExperiment | null;
}

function refuse(id: string, reason: string): MarketingDeclarationError {
  return new MarketingDeclarationError(OPERATION, id, reason);
}

function parseOrRefuse<T>(id: string, field: string, parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    throw refuse(id, `${field}: ${describeIssue(error)}`);
  }
}

function declaredExperiment(
  id: string,
  experiment: MarketingExperimentDeclaration | null | undefined,
): DeclaredExperiment | null {
  const parsed = parseOrRefuse(id, "experiment", () =>
    experimentInputSchema.parse(
      experiment
        ? {
            key: experiment.key,
            variations: experiment.variations,
            status: experiment.status,
          }
        : null,
    ),
  );
  if (!parsed) {
    return null;
  }
  return {
    key: parsed.key,
    variations: parsed.variations.map((v) => ({
      key: v.key,
      weight: v.weight,
    })),
    status: parsed.status ?? "draft",
  };
}

function declaredContent(
  id: string,
  declaration: MarketingFunnelDeclaration,
): FunnelContent {
  const name = parseOrRefuse(id, "name", () =>
    nameSchema.parse(declaration.name),
  );
  const hours = parseOrRefuse(id, "conversionWindowHours", () =>
    windowSchema.parse(declaration.conversionWindowHours),
  );
  return {
    websiteId: parseOrRefuse(id, "websiteId", () =>
      declaredIdSchema.parse(declaration.websiteId),
    ),
    name,
    steps: parseOrRefuse(id, "steps", () =>
      funnelStepsSchema.parse(declaration.steps),
    ).map((step) => ({ kind: step.kind, value: step.value })),
    conversionWindowMs:
      (hours ?? DEFAULT_CONVERSION_WINDOW_HOURS) * MS_PER_HOUR,
    experiment: declaredExperiment(id, declaration.experiment),
  };
}

/** A caller-given instant of a run, never in the future; now by default. */
function runInstant(
  id: string,
  field: string,
  value: MarketingExperimentDeclaration["startedAt" | "stoppedAt"],
): number {
  const now = Date.now();
  if (value === undefined) {
    return now;
  }
  const at = instantOf(value);
  if (at === undefined || at > now) {
    throw refuse(id, `experiment.${field}: not a past instant`);
  }
  return at;
}

/**
 * The runs of a split created with `to`: none in draft, one open run when
 * running, one closed run when stopped (a finished test shipped with its
 * history). A run never ends before it started.
 */
function declaredRuns(
  id: string,
  to: ExperimentStatus,
  declaration: MarketingExperimentDeclaration | null | undefined,
): ExperimentRun[] {
  if (to === "draft") {
    return [];
  }
  const startedAt = runInstant(id, "startedAt", declaration?.startedAt);
  if (to === "running") {
    return [{ startedAt, stoppedAt: null }];
  }
  const stoppedAt = runInstant(id, "stoppedAt", declaration?.stoppedAt);
  if (stoppedAt < startedAt) {
    throw refuse(id, "experiment.stoppedAt: before experiment.startedAt");
  }
  return [{ startedAt, stoppedAt }];
}

/** The experiment to store, with the runs its status implies. */
function resolvedExperiment(
  id: string,
  content: FunnelContent,
  declaration: MarketingFunnelDeclaration,
): FunnelExperiment | null {
  const requested = content.experiment;
  if (!requested) {
    return null;
  }
  return {
    key: requested.key,
    status: requested.status,
    variations: requested.variations,
    runs: declaredRuns(id, requested.status, declaration.experiment),
  };
}

async function assertWebsiteOfTenant(
  id: string,
  websiteId: string,
  tenantId: string,
): Promise<void> {
  const website = await GetModel(WebsitesModel).get(websiteId);
  if (!website || website.tenantId !== tenantId) {
    throw refuse(id, `no website "${websiteId}" in the tenant "${tenantId}"`);
  }
}

async function assertUniqueKey(
  id: string,
  model: FunnelsModel,
  websiteId: string,
  experiment: FunnelExperiment | null,
): Promise<void> {
  if (experiment && (await model.hasKey(websiteId, experiment.key, id))) {
    throw refuse(
      id,
      `another funnel of the website already uses the experiment key "${experiment.key}"`,
    );
  }
}

/**
 * EnsureFunnel: the declared id is the funnel id within its tenant. Written
 * once, when the tenant is provisioned: an id that already exists is `kept`.
 */
export async function ensureFunnel(
  declaration: MarketingFunnelDeclaration,
): Promise<MarketingDeclarationResult> {
  const id = requireDeclaredId(OPERATION, declaration?.id);
  const tenantId = declaredTenant(OPERATION, id, declaration.tenantId);
  const content = declaredContent(id, declaration);
  await assertWebsiteOfTenant(id, content.websiteId, tenantId);
  const model = GetModel(FunnelsModel, tenantId);
  const existing = await model.get(id);
  if (existing) {
    return { id, status: "kept" };
  }
  const experiment = resolvedExperiment(id, content, declaration);
  await assertUniqueKey(id, model, content.websiteId, experiment);
  const funnel = {
    _id: id,
    websiteId: content.websiteId,
    name: content.name,
    steps: content.steps,
    conversionWindowMs: content.conversionWindowMs,
    experiment,
  };
  try {
    await model.insert(funnel);
  } catch (err) {
    if (!(await model.get(id))) {
      throw err;
    }
    return { id, status: "kept" };
  }
  invalidateExperimentDefinitions(content.websiteId);
  return { id, status: "created" };
}
