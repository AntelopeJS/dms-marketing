import { isRecord, isString } from "../shared/guards";
import { type Outbox, eventBase } from "./outbox";

/** Experiment name to the variation the backend assigned this visitor. */
type Assignments = ReadonlyMap<string, string>;

function decodeAssignments(published: unknown): Assignments {
  const assignments = new Map<string, string>();
  if (isRecord(published)) {
    for (const [experiment, assigned] of Object.entries(published)) {
      if (isString(assigned)) {
        assignments.set(experiment, assigned);
      }
    }
  }
  return assignments;
}

/** The A/B assignments of the visitor and the exposures reported for them. */
export interface Experiments {
  /**
   * Lazy: the request fires on the first call only, so the many pages without
   * experiments never pay it. A `<script src>` rather than a `fetch()`
   * because reading a cross-origin response would need the CORS grant client
   * sites are promised never to need; per-visitor, so the backend serves it
   * no-store and it must never ride inside tracker.js (which is cached shared
   * for an hour).
   */
  load(website: string): Promise<Assignments>;
  /** One exposure per experiment per page load: all the per-session variation split needs, and what keeps long SPA sessions from flooding collect. */
  reportExposure(experiment: string, variation: string): void;
  /** The tag's website changed: the assignments were the previous website's experiments. */
  reset(): void;
}

export function createExperiments(
  hostUrl: string,
  outbox: Outbox,
): Experiments {
  let assignmentsPromise: Promise<Assignments> | null = null;
  const exposedExperiments = new Set<string>();

  return {
    load(website) {
      if (!assignmentsPromise) {
        assignmentsPromise = new Promise<Assignments>((resolve) => {
          const loader = document.createElement("script");
          loader.async = true;
          loader.src = `${hostUrl}/api/marketing/experiments.js?website=${encodeURIComponent(website)}`;
          const settle = () => {
            const published = window.__dmsMarketingAssignments;
            delete window.__dmsMarketingAssignments;
            loader.remove();
            resolve(decodeAssignments(published));
          };
          loader.addEventListener("load", settle);
          loader.addEventListener("error", settle);
          document.head.appendChild(loader);
        });
      }
      return assignmentsPromise;
    },
    reportExposure(experiment, variation) {
      if (exposedExperiments.has(experiment)) {
        return;
      }
      exposedExperiments.add(experiment);
      outbox.enqueue({
        ...eventBase(),
        kind: "exposure",
        name: experiment,
        data: { experiment, variation },
      });
    },
    reset() {
      assignmentsPromise = null;
      exposedExperiments.clear();
    },
  };
}
