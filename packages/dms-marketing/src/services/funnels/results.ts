import type { MarketingEventsModel } from "@/db";
import type { Funnel, FunnelExperiment } from "@/db/tables/funnels.table";
import {
  computeExperimentResults,
  type ExperimentResults,
  type ResultEvent,
} from "@/services/experiments/results";
import type { EventKind } from "@/types";
import { MAX_FUNNEL_EVENTS } from "@/types/constants";
import {
  computeFunnelOverSessions,
  type FunnelComputation,
  groupBySession,
} from "./compute";

export interface FunnelResults {
  computation: FunnelComputation;
  /** Present when the funnel carries an experiment past draft. */
  experiment?: ExperimentResults;
  /** The event window hit its cap: numbers cover the oldest part of the
   * period only, and experiment verdicts are withheld — a p-value on a
   * silently truncated sample is wrong, not approximate. */
  truncated: boolean;
  /** The window the numbers cover, epoch milliseconds: the requested period
   * on a plain funnel, else the experiment's first start to its last stop —
   * a pause inside it counts for nothing. The read itself reaches one
   * conversion window past the last stop, so a session exposed just before
   * it still counts its goal. */
  window: { since: number; until: number };
}

interface EventWindow {
  since: Date;
  until: Date;
}

const FUNNEL_EVENT_KINDS: EventKind[] = ["pageview", "custom"];
/** Plus the exposures, which map sessions to arms. */
const EXPERIMENT_EVENT_KINDS: EventKind[] = [...FUNNEL_EVENT_KINDS, "exposure"];

const EXPOSURE_KIND: EventKind = "exposure";

const FUNNEL_FIELDS = ["sessionId", "kind", "url", "name"] as const;
/** Plus `data`, which only the exposure events use — the variation an arm
 * was served is read off it and nowhere else. */
const EXPERIMENT_FIELDS = [...FUNNEL_FIELDS, "data"] as const;

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
  until: Date,
): EventWindow[] | null {
  if (experiment.status === "draft") {
    return null;
  }
  return experiment.runs.map((run) => ({
    since: new Date(run.startedAt),
    until: run.stoppedAt === null ? until : new Date(run.stoppedAt),
  }));
}

/**
 * One fetch covering every run, plus the tail the last one's exposed sessions
 * may still be converting in: a session exposed a minute before the stop has
 * the funnel's whole conversion window to reach the goal, and cutting the
 * read at the stop would drop those conversions — and move the numbers at the
 * moment of stopping, which is the opposite of freezing them. The pause
 * between two runs is fetched with the rest and costs one range scan less
 * than a fetch per run; what it holds is discarded by `withinRuns`.
 */
function readWindow(
  runs: EventWindow[],
  funnel: Funnel,
  until: Date,
): EventWindow {
  const since = Math.min(...runs.map((run) => run.since.getTime()));
  const last = Math.max(...runs.map((run) => run.until.getTime()));
  return {
    since: new Date(since),
    until: new Date(
      Math.min(last + funnel.conversionWindowMs, until.getTime()),
    ),
  };
}

/** Exposures outside every run never count; funnel events are kept whole —
 * the conversion tail is exactly what they are read for. */
function withinRuns(events: ResultEvent[], runs: EventWindow[]): ResultEvent[] {
  const bounds = runs.map((run) => [run.since.getTime(), run.until.getTime()]);
  return events.filter((event) => {
    if (event.kind !== EXPOSURE_KIND) {
      return true;
    }
    const at = event.timestamp.getTime();
    return bounds.some(([since, until]) => at >= since && at <= until);
  });
}

/** What the numbers cover, end to end: the pause inside is the price of one
 * line instead of a list the pane would have to explain. */
function coveredWindow(runs: EventWindow[]): EventWindow {
  return {
    since: new Date(Math.min(...runs.map((run) => run.since.getTime()))),
    until: new Date(Math.max(...runs.map((run) => run.until.getTime()))),
  };
}

/**
 * Read-time computation over the raw event window, so a definition change
 * re-reads history — precomputed counters could not. One bounded fetch feeds
 * the funnel and, when the row carries a started experiment, the per-arm
 * read; the window is then the experiment's runs rather than the requested
 * period, and the plain funnel figure follows it (the pane shows the arms,
 * not the merged funnel, as soon as a split runs).
 */
export async function computeFunnelResults(
  eventsModel: MarketingEventsModel,
  funnel: Funnel,
  since: Date,
  until: Date,
): Promise<FunnelResults> {
  const experiment = funnel.experiment;
  const runs = experiment ? runWindows(experiment, until) : null;
  const read = runs ? readWindow(runs, funnel, until) : { since, until };
  const events = (await eventsModel.queryRange({
    websiteIds: [funnel.websiteId],
    since: read.since,
    until: read.until,
    kinds: runs ? EXPERIMENT_EVENT_KINDS : FUNNEL_EVENT_KINDS,
    limit: MAX_FUNNEL_EVENTS,
    fields: runs ? EXPERIMENT_FIELDS : FUNNEL_FIELDS,
  })) as ResultEvent[];
  const truncated = events.length >= MAX_FUNNEL_EVENTS;
  const usable = runs ? withinRuns(events, runs) : events;
  const reported = runs ? coveredWindow(runs) : read;
  return {
    computation: computeFunnelOverSessions(
      funnel,
      groupBySession(usable).values(),
    ),
    experiment:
      runs && experiment
        ? computeExperimentResults(usable, funnel, experiment, truncated)
        : undefined,
    truncated,
    window: {
      since: reported.since.getTime(),
      until: reported.until.getTime(),
    },
  };
}
