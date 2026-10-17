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
  Funnel,
  FunnelExperiment,
  FunnelStep,
} from "@/db/tables/funnels.table";
import {
  DEFAULT_CONVERSION_WINDOW_HOURS,
  MAX_CONVERSION_WINDOW_HOURS,
  MS_PER_HOUR,
} from "@/types/constants";
import { parseExperimentInput } from "@/utils/experiment-type";
import { parseFunnelSteps } from "@/utils/funnel-steps-type";
import {
  contentHash,
  declaredIdSchema,
  declaredTenant,
  describeIssue,
  instantOf,
  isUntouchedSinceDeclared,
  MarketingDeclarationError,
  requireDeclaredId,
} from "./declarations";
import { invalidateExperimentDefinitions } from "./experiment-definitions";
import { nameSchema } from "./website-rules";

const OPERATION = "EnsureFunnel";

/**
 * Where a declaration may move a split, from where it stands. As on the
 * dashboard, nothing returns to draft — that would unfreeze arms exposures
 * were recorded against. A declaration may also create a split already
 * stopped (a finished test shipped with its history): one run, closed.
 */
const DECLARED_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  draft: ["draft", "running", "stopped"],
  running: ["running", "stopped"],
  stopped: ["stopped", "running"],
};

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

/** What a declaration sets, normalized: also what its hash covers. Runs are
 * left out — they are derived from the moves, never declared. */
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
    parseExperimentInput(
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
      parseFunnelSteps(declaration.steps),
    ).map((step) => ({ kind: step.kind, value: step.value })),
    conversionWindowMs:
      (hours ?? DEFAULT_CONVERSION_WINDOW_HOURS) * MS_PER_HOUR,
    experiment: declaredExperiment(id, declaration.experiment),
  };
}

function storedContent(funnel: Funnel): FunnelContent {
  const experiment = funnel.experiment ?? null;
  return {
    websiteId: funnel.websiteId,
    name: funnel.name,
    steps: funnel.steps.map((step) => ({ kind: step.kind, value: step.value })),
    conversionWindowMs: funnel.conversionWindowMs,
    experiment: experiment
      ? {
          key: experiment.key,
          variations: experiment.variations.map((v) => ({
            key: v.key,
            weight: v.weight,
          })),
          status: experiment.status,
        }
      : null,
  };
}

/** A caller-given instant of a run, never in the future; now by default. */
function runInstant(id: string, field: string, value: unknown): number {
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
 * The runs a declared move leaves: starting appends a run (from
 * `startedAt`), stopping closes the open one (at `stoppedAt`), creating a
 * stopped split records one closed run. A run never starts before the
 * previous one ended, nor ends before it started.
 */
function declaredRuns(
  id: string,
  existing: FunnelExperiment | null,
  to: ExperimentStatus,
  declaration: MarketingExperimentDeclaration | null | undefined,
): ExperimentRun[] {
  const runs = existing?.runs.map((run) => ({ ...run })) ?? [];
  const from = existing?.status ?? "draft";
  if (!DECLARED_TRANSITIONS[from].includes(to)) {
    throw refuse(id, `the experiment cannot move from ${from} to ${to}`);
  }
  if (from === to) {
    return runs;
  }
  const last = runs[runs.length - 1];
  if (to === "stopped" && from === "running" && last) {
    const stoppedAt = runInstant(id, "stoppedAt", declaration?.stoppedAt);
    if (stoppedAt < last.startedAt) {
      throw refuse(id, "experiment.stoppedAt: before the run started");
    }
    last.stoppedAt = stoppedAt;
    return runs;
  }
  const startedAt = runInstant(id, "startedAt", declaration?.startedAt);
  if (last?.stoppedAt != null && startedAt < last.stoppedAt) {
    throw refuse(id, "experiment.startedAt: before the previous run ended");
  }
  if (to === "running") {
    runs.push({ startedAt, stoppedAt: null });
    return runs;
  }
  const stoppedAt = runInstant(id, "stoppedAt", declaration?.stoppedAt);
  if (stoppedAt < startedAt) {
    throw refuse(id, "experiment.stoppedAt: before experiment.startedAt");
  }
  runs.push({ startedAt, stoppedAt });
  return runs;
}

/**
 * The experiment to store. Once a split has left draft, its key, its arms
 * and its website are frozen, as on the dashboard: changing them mid-run
 * would silently reassign visitors.
 */
function resolvedExperiment(
  id: string,
  content: FunnelContent,
  current: Funnel | undefined,
  declaration: MarketingFunnelDeclaration,
): FunnelExperiment | null {
  const existing = current?.experiment ?? null;
  const requested = content.experiment;
  if (existing && existing.status !== "draft") {
    const frozen =
      requested !== null &&
      requested.key === existing.key &&
      JSON.stringify(requested.variations) ===
        JSON.stringify(
          existing.variations.map((v) => ({ key: v.key, weight: v.weight })),
        ) &&
      content.websiteId === current?.websiteId;
    if (!frozen) {
      throw refuse(
        id,
        "the experiment has left draft: its key, variations and website can no longer change",
      );
    }
  }
  if (!requested) {
    return null;
  }
  return {
    key: requested.key,
    status: requested.status,
    variations: requested.variations,
    runs: declaredRuns(id, existing, requested.status, declaration.experiment),
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

async function refreshFunnel(
  model: FunnelsModel,
  existing: Funnel,
  content: FunnelContent,
  declaration: MarketingFunnelDeclaration,
): Promise<MarketingDeclarationResult> {
  const id = existing._id;
  if (
    !isUntouchedSinceDeclared(existing.declaredHash, storedContent(existing))
  ) {
    if (existing.declaredHash) {
      await model.update(id, { declaredHash: "" });
    }
    return { id, status: "kept" };
  }
  const declaredHash = contentHash(content);
  if (declaredHash === existing.declaredHash) {
    return { id, status: "unchanged" };
  }
  const experiment = resolvedExperiment(id, content, existing, declaration);
  await assertUniqueKey(id, model, content.websiteId, experiment);
  const previousWebsiteId = existing.websiteId;
  Object.assign(existing, {
    websiteId: content.websiteId,
    name: content.name,
    steps: content.steps,
    conversionWindowMs: content.conversionWindowMs,
    experiment,
    declaredHash,
  });
  await model.update(existing);
  invalidateExperimentDefinitions(content.websiteId);
  if (previousWebsiteId !== content.websiteId) {
    invalidateExperimentDefinitions(previousWebsiteId);
  }
  return { id, status: "updated" };
}

/** EnsureFunnel: the declared id is the funnel id within its tenant. */
export async function ensureFunnel(
  declaration: MarketingFunnelDeclaration,
): Promise<MarketingDeclarationResult> {
  const id = requireDeclaredId(OPERATION, declaration?.id);
  const tenantId = declaredTenant(declaration.tenantId);
  const content = declaredContent(id, declaration);
  await assertWebsiteOfTenant(id, content.websiteId, tenantId);
  const model = GetModel(FunnelsModel, tenantId);
  const existing = await model.get(id);
  if (existing) {
    return refreshFunnel(model, existing, content, declaration);
  }
  const experiment = resolvedExperiment(id, content, undefined, declaration);
  await assertUniqueKey(id, model, content.websiteId, experiment);
  const funnel = {
    _id: id,
    websiteId: content.websiteId,
    name: content.name,
    steps: content.steps,
    conversionWindowMs: content.conversionWindowMs,
    experiment,
    declaredHash: contentHash(content),
  } as Funnel;
  try {
    await model.insert(funnel);
  } catch (err) {
    const raced = await model.get(id);
    if (!raced) {
      throw err;
    }
    return refreshFunnel(model, raced, content, declaration);
  }
  invalidateExperimentDefinitions(content.websiteId);
  return { id, status: "created" };
}
