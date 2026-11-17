import { GetModel } from "@antelopejs/interface-database-decorators";
import { FunnelTrailBackfillsModel, FunnelTrailsModel } from "@/db";
import { coversSince } from "@/db/models/funnel_trail_backfills.model";
import type { TrailEvent } from "@/db/models/funnel_trails.model";
import type { Funnel, FunnelExperiment } from "@/db/tables/funnels.table";
import {
  type ExperimentResults,
  ExperimentTally,
} from "@/services/experiments/results";
import type { QueryWindow } from "@/services/period";
import { type FunnelComputation, FunnelTally } from "./compute";

export interface FunnelResults {
  computation: FunnelComputation;
  /** Present when the funnel carries an experiment past draft. */
  experiment?: ExperimentResults;
  /**
   * Some events of the period are not in the numbers: the website's history
   * is still being indexed below the period's start, or a session longer than
   * `MAX_TRAIL_EVENTS` dropped events at or before the period's end.
   * Experiment verdicts are then withheld, and no step is called unseen.
   */
  incomplete: boolean;
  /** The window the numbers cover, epoch milliseconds: the requested period
   * on a plain funnel, else the experiment's first start to its last stop —
   * a pause inside it counts for nothing. The read itself reaches one
   * conversion window past the last stop, so a session exposed just before
   * it still counts its goal. */
  window: { since: number; until: number };
}

/** What a result read needs of a funnel, so a draft that is not saved reads too. */
export type ReadableFunnel = Pick<
  Funnel,
  "websiteId" | "steps" | "conversionWindowMs" | "experiment"
>;

interface EventWindow {
  since: number;
  until: number;
}

/**
 * The stretches of time a split served traffic. An experiment is read over
 * its own runs and not over the pane's period: stopping ends assignment, so
 * anything exposed past a stop is what the stop cannot reach (a page loaded
 * before it, a hand-rolled `dmsMarketing.exposure()` call, a forged beacon),
 * and a finished test whose numbers moved with whatever period the pane
 * happens to show would never be final. A split stopped and started again
 * has several runs, and the pause between them belongs to neither.
 *
 * Null while the split has never served traffic — a draft has no results,
 * only the plain funnel underneath it. Every other status has been through
 * `running`, which appends a run, so the list is never empty here.
 */
function runWindows(
  experiment: FunnelExperiment,
  until: number,
): EventWindow[] | null {
  if (experiment.status === "draft") {
    return null;
  }
  return experiment.runs.map((run) => ({
    since: run.startedAt,
    until: run.stoppedAt ?? until,
  }));
}

/**
 * One read covering every run, plus the tail the last one's exposed sessions
 * may still be converting in: a session exposed a minute before the stop has
 * the funnel's whole conversion window to reach the goal, and cutting the
 * read at the stop would drop those conversions — and move the numbers at the
 * moment of stopping, which is the opposite of freezing them.
 */
function readWindow(
  runs: EventWindow[],
  funnel: ReadableFunnel,
  until: number,
): EventWindow {
  const { since, until: last } = coveredWindow(runs);
  return {
    since,
    until: Math.min(last + funnel.conversionWindowMs, until),
  };
}

/** Exposures outside every run never count; funnel events are kept whole —
 * the conversion tail is exactly what they are read for. */
function withinRuns(
  events: readonly TrailEvent[],
  runs: EventWindow[],
): TrailEvent[] {
  return events.filter(
    (event) =>
      event.kind !== "exposure" ||
      runs.some((run) => event.at >= run.since && event.at <= run.until),
  );
}

/** What the numbers cover, end to end: the pause inside is the price of one
 * line instead of a list the pane would have to explain. */
function coveredWindow(runs: EventWindow[]): EventWindow {
  return {
    since: Math.min(...runs.map((run) => run.since)),
    until: Math.max(...runs.map((run) => run.until)),
  };
}

/** How long the runs served traffic: the pauses between them count for nothing. */
function servedMs(runs: EventWindow[]): number {
  return runs.reduce((sum, run) => sum + Math.max(0, run.until - run.since), 0);
}

/**
 * Read-time computation over the funnel trails of the period, so a
 * definition change re-reads history — precomputed counters could not. One
 * streamed pass feeds the funnel and, when the row carries a started
 * experiment, the per-arm read; the window is then the experiment's runs
 * rather than the requested period, and the plain funnel figure follows it
 * (the pane shows the arms, not the merged funnel, as soon as a split runs).
 *
 * The hourly prune cuts the trails at the instant it cuts the raw events, so
 * the read counts what the events table holds. Memory holds one session and
 * the counters, whatever the period holds.
 */
export async function funnelResultsIn(
  funnel: ReadableFunnel,
  tenantId: string,
  window: Pick<QueryWindow, "since" | "until">,
): Promise<FunnelResults> {
  const until = window.until.getTime();
  const experiment = funnel.experiment;
  const runs = experiment ? runWindows(experiment, until) : null;
  const read = runs
    ? readWindow(runs, funnel, until)
    : { since: window.since.getTime(), until };
  const since = read.since;
  const indexed = coversSince(
    await GetModel(FunnelTrailBackfillsModel, tenantId).coverage(
      funnel.websiteId,
    ),
    since,
  );
  const plain = new FunnelTally(funnel);
  const arms =
    runs && experiment ? new ExperimentTally(funnel, experiment) : null;
  let cut = false;
  for await (const session of GetModel(FunnelTrailsModel, tenantId).sessionsIn({
    websiteId: funnel.websiteId,
    since,
    until: read.until,
    withExposures: runs !== null,
  })) {
    const usable = runs ? withinRuns(session.events, runs) : session.events;
    plain.add(usable);
    arms?.add(usable);
    cut ||= session.incomplete;
  }
  const incomplete = cut || !indexed;
  return {
    computation: plain.result(),
    experiment:
      runs && arms ? arms.result(incomplete, servedMs(runs)) : undefined,
    incomplete,
    window: runs ? coveredWindow(runs) : read,
  };
}
