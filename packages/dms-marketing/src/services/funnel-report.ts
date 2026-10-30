import { GetModel } from "@antelopejs/interface-database-decorators";
import { getConfig } from "@/config";
import { MarketingEventsModel } from "@/db";
import type { Funnel, FunnelStep } from "@/db/tables/funnels.table";
import type { Website } from "@/db/tables/websites.table";
import {
  FUNNEL_SUMMARY_CACHE_TTL_MS,
  MAX_FUNNEL_EVENTS,
  MS_PER_DAY,
  MS_PER_HOUR,
  RAW_COVERAGE_CACHE_TTL_MS,
} from "@/types/constants";
import { BoundedCache } from "./bounded-cache";
import {
  computeFunnelResults,
  type FunnelResults,
  groupBySession,
  type ReadableFunnel,
} from "./funnels";
import type { QueryWindow } from "./period";
import {
  mergeDimension,
  type RankedEntry,
  rankEntries,
  readRollups,
} from "./rollups";

export type FunnelKind = "funnel" | "ab";

/** The challenger the report names: same rule here and in the report. */
export interface ExperimentLeader {
  key: string;
  /** Position among the arms, the control being 0: its letter. */
  index: number;
  /** Relative lift over the control, in percent; ≤ 0 when the control leads. */
  uplift: number;
  significant: boolean;
}

export interface ExperimentSummary {
  key: string;
  status: string;
  variations: number;
  since: number | null;
  until: number | null;
  leader: ExperimentLeader | null;
  exposed: number;
  /** Significant, ahead, and past the decision rule (a week, a sample). */
  ready: boolean;
  /** Lift bounds of the leader in percent, with `days` served. */
  upliftLow: number | null;
  upliftHigh: number | null;
  days: number;
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
  /** A step the site never sent over the window while it sent other events. */
  unseenStep: string | null;
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

/**
 * The first step no event of the window matched, while the site did send
 * something: an event nobody tracks yet, or a path that matches no page. A
 * site that sent nothing at all has no traffic, not a broken step, and a
 * read cut at its cap may have stopped before the step's first event.
 */
export function unseenStepOf(results: FunnelResults): string | null {
  const computation = results.computation;
  if (computation.events === 0 || results.truncated) {
    return null;
  }
  return (
    computation.steps.find((step) => step.matches === 0)?.step.value ?? null
  );
}

type ArmResult = NonNullable<FunnelResults["experiment"]>["variations"][number];

/**
 * The challenger with the best rate among those the test could score: the
 * one the report's verdict names. It may trail the control.
 */
function pickLeader(arms: ArmResult[]): number {
  let best = -1;
  arms.forEach((arm, index) => {
    if (index === 0 || arm.pValue === null) {
      return;
    }
    if (best === -1 || arm.conversionRate > arms[best].conversionRate) {
      best = index;
    }
  });
  return best;
}

/**
 * What a started test says: `withheld` when a warning voids the reading
 * (truncated window, sample ratio mismatch, no challenger scored), `flat`
 * when the leader is not significant, `early` when it is but the decision
 * rule (a week, a conversions floor) is not met yet.
 */
export type ExperimentVerdictKind =
  | "winner"
  | "loser"
  | "flat"
  | "early"
  | "withheld";

export interface ExperimentVerdict {
  kind: ExperimentVerdictKind;
  /** Index of the arm the verdict names, the control being 0; null when no
   * challenger could be scored. */
  leader: number | null;
}

/**
 * The one reading of a started test, shared by the list, the report and its
 * stop dialog. Null on a funnel without one.
 */
export function experimentVerdict(
  results: FunnelResults,
): ExperimentVerdict | null {
  const read = results.experiment;
  if (!read) {
    return null;
  }
  const arms = read.variations;
  const index = pickLeader(arms);
  const leader = index === -1 ? null : index;
  const unscored = arms.slice(1).every((arm) => arm.significant === null);
  const best = leader === null ? undefined : arms[leader];
  let kind: ExperimentVerdictKind;
  if (results.truncated || read.srm.mismatch || unscored || !best) {
    kind = "withheld";
  } else if (!best.significant) {
    kind = "flat";
  } else if (!read.decision.ready) {
    kind = "early";
  } else {
    kind = (best.uplift ?? 0) > 0 ? "winner" : "loser";
  }
  return { kind, leader };
}

function leaderOf(
  arms: ArmResult[],
  verdict: ExperimentVerdict | null,
): ExperimentLeader | null {
  const index = verdict?.leader ?? null;
  const best = index === null ? null : arms[index];
  if (index === null || !best || best.uplift === null) {
    return null;
  }
  return {
    key: best.key,
    index,
    uplift: best.uplift * 100,
    significant: best.significant === true,
  };
}

function percentOrNull(ratio: number | null | undefined): number | null {
  return ratio === null || ratio === undefined ? null : ratio * 100;
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
  const read = started ? results.experiment : undefined;
  const arms = read?.variations ?? [];
  const verdict = read ? experimentVerdict(results) : null;
  const leader = leaderOf(arms, verdict);
  const best = leader ? arms[leader.index] : undefined;
  return {
    key: experiment.key,
    status: experiment.status,
    variations: experiment.variations.length,
    since: started ? results.window.since : null,
    until: experiment.status === "stopped" ? results.window.until : null,
    leader,
    exposed: arms.reduce((sum, arm) => sum + arm.exposedSessions, 0),
    ready: verdict?.kind === "winner",
    upliftLow: percentOrNull(best?.upliftLow),
    upliftHigh: percentOrNull(best?.upliftHigh),
    days: read?.decision.days ?? 0,
  };
}

export async function funnelResultsIn(
  funnel: ReadableFunnel,
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

/** A split read over its runs has no "previous window"; a draft is still a
 * plain funnel over the period. */
export function readsPeriod(funnel: Funnel): boolean {
  return !funnel.experiment || funnel.experiment.status === "draft";
}

const coverageCache = new BoundedCache<number | null>(
  RAW_COVERAGE_CACHE_TTL_MS,
);

/**
 * The first instant a website's raw events cover: the retention cutoff, or
 * its oldest stored event when that is later (a site installed last week, a
 * retention raised since). Null when it has none. Funnels read raw events
 * only, so a window starting before it counts nothing for its first days.
 */
export async function rawCoverageStart(
  tenantId: string,
  websiteId: string,
): Promise<number | null> {
  const key = `${tenantId}:${websiteId}`;
  const hit = coverageCache.get(key);
  if (hit) {
    return hit.value;
  }
  const now = Date.now();
  const [first] = await GetModel(MarketingEventsModel, tenantId).queryRange({
    websiteIds: [websiteId],
    since: new Date(now - getConfig().rawEventsRetention),
    until: new Date(now),
    limit: 1,
    fields: [],
  });
  const start = first ? first.timestamp.getTime() : null;
  coverageCache.set(key, start);
  return start;
}

/**
 * Whether raw events cover a window, its first day aside: the oldest event
 * rarely falls on a midnight, and a window short of a few hours on its first
 * day still reads true enough.
 */
export function coversWindow(
  window: QueryWindow,
  coverage: number | null,
): boolean {
  return coverage !== null && window.since.getTime() + MS_PER_DAY > coverage;
}

/**
 * Per funnel and window, the promise itself: the list's rows, its tab
 * counters and its banner arrive together and share one computation. The
 * definition is part of the key, so an edit is never served stale.
 */
const summaryCache = new BoundedCache<Promise<FunnelSummaryRow>>(
  FUNNEL_SUMMARY_CACHE_TTL_MS,
);

function summaryKey(
  funnel: Funnel,
  tenantId: string,
  window: QueryWindow,
  compare: QueryWindow | null,
): string {
  return JSON.stringify([
    tenantId,
    funnel._id,
    funnel.name,
    funnel.steps,
    funnel.conversionWindowMs,
    funnel.experiment,
    window.firstDay,
    window.lastDay,
    compare?.firstDay ?? null,
    compare?.lastDay ?? null,
  ]);
}

/**
 * One row of the list. `compare` is the comparison window, already dropped
 * by the caller when raw events do not cover it.
 */
export function summarizeFunnel(
  funnel: Funnel,
  tenantId: string,
  window: QueryWindow,
  compare: QueryWindow | null,
): Promise<FunnelSummaryRow> {
  const key = summaryKey(funnel, tenantId, window, compare);
  const hit = summaryCache.get(key);
  if (hit) {
    return hit.value;
  }
  const pending = computeSummary(funnel, tenantId, window, compare);
  summaryCache.set(key, pending);
  pending.catch(() => summaryCache.delete(key));
  return pending;
}

async function computeSummary(
  funnel: Funnel,
  tenantId: string,
  window: QueryWindow,
  compare: QueryWindow | null,
): Promise<FunnelSummaryRow> {
  const [results, previous] = await Promise.all([
    funnelResultsIn(funnel, tenantId, window),
    compare && readsPeriod(funnel)
      ? funnelResultsIn(funnel, tenantId, compare)
      : Promise.resolve(null),
  ]);
  const { entered, completed } = endToEnd(results);
  const conversion = conversionOf(results);
  const before = conversionOf(previous);
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
      conversion !== null && before !== null ? conversion - before : null,
    unseenStep: unseenStepOf(results),
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

/** A funnel the site's own journeys suggest, with the sessions it would score. */
export interface FunnelTemplate {
  steps: FunnelStep[];
  /** Sessions of the window that would enter it (that matched step 1). */
  entering: number;
}

const MAX_TEMPLATES = 2;

function increment(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function mostFrequent(counts: Map<string, number>): string | null {
  let best: string | null = null;
  for (const [key, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) {
      best = key;
    }
  }
  return best;
}

/**
 * Templates for a site without funnels, from real journeys: its custom
 * events triggered by the most sessions, each led by the page those sessions
 * viewed most often before it. `entering` counts the sessions that viewed
 * that page, the ones the funnel would see enter.
 */
export async function funnelTemplates(
  website: Website,
  window: QueryWindow,
): Promise<FunnelTemplate[]> {
  const events = await GetModel(
    MarketingEventsModel,
    website.tenantId,
  ).queryRange({
    websiteIds: [website._id],
    since: window.since,
    until: window.until,
    kinds: ["pageview", "custom"],
    limit: MAX_FUNNEL_EVENTS,
    fields: ["sessionId", "kind", "url", "name"],
  });
  const sessions = [...groupBySession(events).values()];
  const sessionsByEvent = new Map<string, number>();
  const sessionsByPage = new Map<string, number>();
  for (const session of sessions) {
    const names = new Set<string>();
    const pages = new Set<string>();
    for (const event of session) {
      if (event.kind === "custom" && event.name) {
        names.add(event.name);
      } else if (event.kind === "pageview") {
        pages.add(event.url);
      }
    }
    names.forEach((name) => increment(sessionsByEvent, name));
    pages.forEach((page) => increment(sessionsByPage, page));
  }
  const topEvents = [...sessionsByEvent.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TEMPLATES)
    .map(([name]) => name);
  return topEvents.map((name) => {
    const before = new Map<string, number>();
    for (const session of sessions) {
      const at = session.findIndex(
        (event) => event.kind === "custom" && event.name === name,
      );
      if (at <= 0) {
        continue;
      }
      const pages = new Set(
        session
          .slice(0, at)
          .filter((event) => event.kind === "pageview")
          .map((event) => event.url),
      );
      pages.forEach((page) => increment(before, page));
    }
    const page = mostFrequent(before);
    return page
      ? {
          steps: [
            { kind: "url", value: page },
            { kind: "custom", value: name },
          ],
          entering: sessionsByPage.get(page) ?? 0,
        }
      : {
          steps: [{ kind: "custom", value: name }],
          entering: sessionsByEvent.get(name) ?? 0,
        };
  });
}
