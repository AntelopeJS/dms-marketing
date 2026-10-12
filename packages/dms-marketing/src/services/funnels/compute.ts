import type { Funnel, FunnelStep } from "@/db/tables/funnels.table";
import type { MarketingEvent } from "@/db/tables/marketing_events.table";
import { stepPathMatcher } from "./step-path";

/** What the counting core needs of a funnel. */
export type FunnelDefinition = Pick<Funnel, "steps" | "conversionWindowMs">;

interface FunnelStepResult {
  step: FunnelStep;
  sessions: number;
  conversionRate: number;
  /** Events of the window matching the step, in order or not: 0 means the
   * site never sent it, and no rate past it is worth reading. */
  matches: number;
}

export interface FunnelComputation {
  totalSessions: number;
  /** Events walked: 0 means the site sent nothing over the window at all. */
  events: number;
  steps: FunnelStepResult[];
}

/**
 * What the counting core reads off an event — and, through the results
 * loader's projection, all that travels back from the database. Kept as a
 * Pick so adding a field to the algorithm cannot silently forget the
 * projection.
 */
export type FunnelEvent = Pick<
  MarketingEvent,
  "sessionId" | "kind" | "url" | "name" | "timestamp"
>;

type StepMatcher = (event: FunnelEvent) => boolean;

/**
 * A page step matches its path whatever was pasted around it (see
 * normalizeStepPath), ignoring the case and a trailing slash, or as a prefix
 * when it ends in `*`; an event step matches its name exactly.
 */
function stepMatcher(step: FunnelStep): StepMatcher {
  if (step.kind === "custom") {
    return (event) => event.kind === "custom" && event.name === step.value;
  }
  const matchesPath = stepPathMatcher(step.value);
  return (event) => event.kind === "pageview" && matchesPath(event.url);
}

export function groupBySession<T extends Pick<MarketingEvent, "sessionId">>(
  events: T[],
): Map<string, T[]> {
  const sessions = new Map<string, T[]>();
  for (const event of events) {
    const bucket = sessions.get(event.sessionId);
    if (bucket) {
      bucket.push(event);
    } else {
      sessions.set(event.sessionId, [event]);
    }
  }
  return sessions;
}

/** Steps must match in order; the window counts from the first-step match. */
function sessionProgress(
  events: FunnelEvent[],
  funnel: FunnelDefinition,
  matchers: StepMatcher[],
): number {
  let reached = 0;
  let enteredAt: number | undefined;
  for (const event of events) {
    if (reached >= funnel.steps.length) {
      break;
    }
    if (
      enteredAt !== undefined &&
      event.timestamp.getTime() - enteredAt > funnel.conversionWindowMs
    ) {
      break;
    }
    if (matchers[reached](event)) {
      if (reached === 0) {
        enteredAt = event.timestamp.getTime();
      }
      reached++;
    }
  }
  return reached;
}

/**
 * The counting core, decoupled from loading so the experiment read can run
 * it on session subsets (one per variation) of a single event fetch.
 */
export function computeFunnelOverSessions(
  funnel: FunnelDefinition,
  sessions: Iterable<FunnelEvent[]>,
): FunnelComputation {
  if (funnel.steps.length === 0) {
    return { totalSessions: 0, events: 0, steps: [] };
  }
  const matchers = funnel.steps.map(stepMatcher);
  const reachedCounts = funnel.steps.map(() => 0);
  const matchCounts = funnel.steps.map(() => 0);
  let events = 0;
  for (const sessionEvents of sessions) {
    const reached = sessionProgress(sessionEvents, funnel, matchers);
    for (let i = 0; i < reached; i++) {
      reachedCounts[i]++;
    }
    events += sessionEvents.length;
    for (const event of sessionEvents) {
      matchers.forEach((matches, i) => {
        if (matches(event)) {
          matchCounts[i]++;
        }
      });
    }
  }

  const entered = reachedCounts[0] ?? 0;
  return {
    totalSessions: entered,
    events,
    steps: funnel.steps.map((step, i) => ({
      step,
      sessions: reachedCounts[i],
      conversionRate: entered > 0 ? reachedCounts[i] / entered : 0,
      matches: matchCounts[i],
    })),
  };
}
