import type { TrailEvent } from "@/db/models/funnel_trails.model";
import type { Funnel, FunnelStep } from "@/db/tables/funnels.table";
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

type StepMatcher = (event: TrailEvent) => boolean;

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
  return (event) => event.kind === "pageview" && matchesPath(event.path);
}

/**
 * The counting core as a fold over sessions: a read streams sessions in and
 * holds only counters, per step the sessions that reached it and the events
 * that matched it, and the events walked. Every count is a sum over
 * sessions, so sessions may arrive in any order.
 */
export class FunnelTally {
  readonly #funnel: FunnelDefinition;
  readonly #matchers: StepMatcher[];
  readonly #reached: number[];
  readonly #matches: number[];
  #events = 0;

  constructor(funnel: FunnelDefinition) {
    this.#funnel = funnel;
    this.#matchers = funnel.steps.map(stepMatcher);
    this.#reached = funnel.steps.map(() => 0);
    this.#matches = funnel.steps.map(() => 0);
  }

  /** Counts one session, its events in time order. */
  add(events: readonly TrailEvent[]): void {
    const reached = this.#progress(events);
    for (let i = 0; i < reached; i++) {
      this.#reached[i]++;
    }
    this.#events += events.length;
    for (const event of events) {
      this.#matchers.forEach((matches, i) => {
        if (matches(event)) {
          this.#matches[i]++;
        }
      });
    }
  }

  #progress(events: readonly TrailEvent[]): number {
    const { steps, conversionWindowMs } = this.#funnel;
    let reached = 0;
    let enteredAt: number | undefined;
    for (const event of events) {
      if (reached >= steps.length) {
        break;
      }
      if (
        enteredAt !== undefined &&
        event.at - enteredAt > conversionWindowMs
      ) {
        break;
      }
      if (this.#matchers[reached](event)) {
        enteredAt ??= event.at;
        reached++;
      }
    }
    return reached;
  }

  result(): FunnelComputation {
    const steps = this.#funnel.steps;
    if (steps.length === 0) {
      return { totalSessions: 0, events: 0, steps: [] };
    }
    const entered = this.#reached[0];
    return {
      totalSessions: entered,
      events: this.#events,
      steps: steps.map((step, i) => ({
        step,
        sessions: this.#reached[i],
        conversionRate: entered > 0 ? this.#reached[i] / entered : 0,
        matches: this.#matches[i],
      })),
    };
  }
}
