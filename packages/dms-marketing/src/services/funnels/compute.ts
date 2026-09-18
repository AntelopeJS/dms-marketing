import type { Funnel, FunnelStep } from "@/db/tables/funnels.table";
import type { MarketingEvent } from "@/db/tables/marketing_events.table";

/** What the counting core needs of a funnel. */
export type FunnelDefinition = Pick<Funnel, "steps" | "conversionWindowMs">;

export interface FunnelStepResult {
  step: FunnelStep;
  sessions: number;
  conversionRate: number;
}

export interface FunnelComputation {
  totalSessions: number;
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

type StepMatcher = (event: FunnelEvent, value: string) => boolean;

const STEP_MATCHERS: Record<FunnelStep["kind"], StepMatcher> = {
  url: (event, value) => event.kind === "pageview" && event.url === value,
  custom: (event, value) => event.kind === "custom" && event.name === value,
};

function eventMatchesStep(event: FunnelEvent, step: FunnelStep): boolean {
  return STEP_MATCHERS[step.kind](event, step.value);
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
    if (eventMatchesStep(event, funnel.steps[reached])) {
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
    return { totalSessions: 0, steps: [] };
  }
  const reachedCounts = Array.from<number>({
    length: funnel.steps.length,
  }).fill(0);
  for (const sessionEvents of sessions) {
    const reached = sessionProgress(sessionEvents, funnel);
    for (let i = 0; i < reached; i++) {
      reachedCounts[i]++;
    }
  }

  const entered = reachedCounts[0] ?? 0;
  return {
    totalSessions: entered,
    steps: funnel.steps.map((step, i) => ({
      step,
      sessions: reachedCounts[i],
      conversionRate: entered > 0 ? reachedCounts[i] / entered : 0,
    })),
  };
}
