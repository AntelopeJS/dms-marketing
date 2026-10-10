import { GetModel } from "@antelopejs/interface-database-decorators";
import { MarketingEventsModel } from "@/db";
import type { Funnel, FunnelStep } from "@/db/tables/funnels.table";
import type { Website } from "@/db/tables/websites.table";
import { MS_PER_HOUR } from "@/types/constants";
import { computeFunnelResults, type FunnelResults } from "./funnels";
import type { QueryWindow } from "./period";
import {
  mergeDimension,
  type RankedEntry,
  rankEntries,
  readRollups,
} from "./rollups";

export type FunnelKind = "funnel" | "ab";

/** The leading arm of a split, when one is ahead of the control. */
export interface ExperimentLeader {
  key: string;
  /** Relative lift over the control, in percent. */
  uplift: number;
  significant: boolean;
  confidence: number | null;
}

export interface ExperimentSummary {
  key: string;
  status: string;
  variations: number;
  since: number | null;
  until: number | null;
  leader: ExperimentLeader | null;
  exposed: number;
}

interface FunnelTotals {
  entered: number;
  completed: number;
}

export interface FunnelSummaryRow {
  id: string;
  name: string;
  kind: FunnelKind;
  steps: FunnelStep[];
  windowHours: number;
  createdAt: number | null;
  entered: number;
  completed: number;
  /** End-to-end conversion in percent, null before anyone entered. */
  conversion: number | null;
  /** Conversion change vs the comparison window, in points. */
  deltaPoints: number | null;
  experiment: ExperimentSummary | null;
}

function endToEnd(results: FunnelResults): FunnelTotals {
  const steps = results.computation.steps;
  return {
    entered: steps[0]?.sessions ?? 0,
    completed: steps.at(-1)?.sessions ?? 0,
  };
}

function conversionOf(results: FunnelResults | null): number | null {
  if (!results) {
    return null;
  }
  const { entered, completed } = endToEnd(results);
  return entered > 0 ? (completed / entered) * 100 : null;
}

function leaderOf(results: FunnelResults): ExperimentLeader | null {
  const arms = results.experiment?.variations.slice(1) ?? [];
  const best = arms
    .filter((arm) => arm.uplift !== null)
    .sort((a, b) => (b.uplift ?? 0) - (a.uplift ?? 0))[0];
  if (!best || best.uplift === null) {
    return null;
  }
  return {
    key: best.key,
    uplift: best.uplift * 100,
    significant: best.significant === true,
    confidence: best.pValue === null ? null : (1 - best.pValue) * 100,
  };
}

function experimentSummary(
  funnel: Funnel,
  results: FunnelResults,
): ExperimentSummary | null {
  const experiment = funnel.experiment;
  if (!experiment) {
    return null;
  }
  const started = experiment.runs.length > 0;
  return {
    key: experiment.key,
    status: experiment.status,
    variations: experiment.variations.length,
    since: started ? results.window.since : null,
    until: experiment.status === "stopped" ? results.window.until : null,
    leader: started ? leaderOf(results) : null,
    exposed:
      results.experiment?.variations.reduce(
        (sum, arm) => sum + arm.exposedSessions,
        0,
      ) ?? 0,
  };
}

export async function funnelResultsIn(
  funnel: Funnel,
  tenantId: string,
  window: QueryWindow,
): Promise<FunnelResults> {
  return computeFunnelResults(
    GetModel(MarketingEventsModel, tenantId),
    funnel,
    window.since,
    window.until,
  );
}

/**
 * The previous period of a plain funnel only: a split is read over its own
 * runs, so it has no "previous window" to compare with.
 */
async function previousConversion(
  funnel: Funnel,
  tenantId: string,
  compare: QueryWindow | null,
): Promise<number | null> {
  if (!compare || funnel.experiment) {
    return null;
  }
  return conversionOf(await funnelResultsIn(funnel, tenantId, compare));
}

export async function summarizeFunnel(
  funnel: Funnel,
  tenantId: string,
  window: QueryWindow,
  compare: QueryWindow | null,
): Promise<FunnelSummaryRow> {
  const [results, previous] = await Promise.all([
    funnelResultsIn(funnel, tenantId, window),
    previousConversion(funnel, tenantId, compare),
  ]);
  const { entered, completed } = endToEnd(results);
  const conversion = conversionOf(results);
  return {
    id: funnel._id,
    name: funnel.name,
    kind: funnel.experiment ? "ab" : "funnel",
    steps: funnel.steps,
    windowHours: Math.round(funnel.conversionWindowMs / MS_PER_HOUR),
    createdAt: funnel.createdAt ? new Date(funnel.createdAt).getTime() : null,
    entered,
    completed,
    conversion,
    deltaPoints:
      conversion !== null && previous !== null ? conversion - previous : null,
    experiment: experimentSummary(funnel, results),
  };
}

export interface FunnelSuggestion {
  value: string;
  count: number;
}

export interface FunnelSuggestions {
  pages: FunnelSuggestion[];
  events: FunnelSuggestion[];
}

const MAX_SUGGESTIONS = 50;

/** What a step can match, from the site's own rollups, most frequent first. */
export async function funnelSuggestions(
  website: Website,
  window: QueryWindow,
): Promise<FunnelSuggestions> {
  const rows = await readRollups(website, window);
  const toSuggestion = ({ key, value }: RankedEntry): FunnelSuggestion => ({
    value: key,
    count: value,
  });
  return {
    pages: rankEntries(mergeDimension(rows, "topPages"), MAX_SUGGESTIONS).map(
      toSuggestion,
    ),
    events: rankEntries(mergeDimension(rows, "topEvents"), MAX_SUGGESTIONS).map(
      toSuggestion,
    ),
  };
}
