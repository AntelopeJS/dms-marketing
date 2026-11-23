import { isString } from "../shared/guards";
import type { Experiments } from "./experiments";
import { type EventData, type Outbox, eventBase } from "./outbox";
import { type TrackerSession, tagNamesWebsite } from "./session";

/** Mirrors the backend MAX_EVENT_NAME_LENGTH. */
const MAX_EVENT_NAME_LENGTH = 50;

/** The API the tracker installs as `window.dmsMarketing` (see docs/4.usage/9.tracking.md). */
export interface MarketingApi {
  /**
   * Reports a custom event. Page code is untyped: a name that is not a
   * string goes out as it is, for the backend to refuse, so a call never
   * throws.
   */
  track(name: string, data?: EventData): void;
  /**
   * Assigned variation of a running experiment, or null. Reports the
   * exposure, so only call it where the variation is actually applied.
   */
  variation(experiment: string): Promise<string | null>;
  /** Low-level escape hatch for integrations that assign on their own. */
  exposure(experiment: string, variation: string): void;
}

declare global {
  interface Window {
    /** The page-facing API, published on every path that loads the tracker, so `track(…)` in page code never throws. */
    dmsMarketing?: MarketingApi;
    /** Set by the first tracker that starts collecting on the page. */
    __dmsMarketingInstalled?: boolean;
  }
}

/** The no-op variation() resolves null: a visitor that collects nothing (DNT) renders the control. */
export const NOOP_API: MarketingApi = {
  track() {},
  exposure() {},
  variation() {
    return Promise.resolve(null);
  },
};

/** Installs `api` as the page's API, or the no-op one. */
export function publishApi(api: MarketingApi = NOOP_API): void {
  window.dmsMarketing = api;
}

/** The API of a collecting tracker. */
export function createApi(
  session: TrackerSession,
  outbox: Outbox,
  experiments: Experiments,
): MarketingApi {
  return {
    track(name, data) {
      outbox.enqueue({
        ...eventBase(),
        kind: "custom",
        name: isString(name) ? name.slice(0, MAX_EVENT_NAME_LENGTH) : name,
        data,
      });
    },
    variation(experiment) {
      const requestedWebsite = session.websiteId;
      if (!requestedWebsite || !tagNamesWebsite(session, requestedWebsite)) {
        return Promise.resolve(null);
      }
      return experiments.load(requestedWebsite).then((assignments) => {
        if (
          session.websiteId !== requestedWebsite ||
          !tagNamesWebsite(session, requestedWebsite)
        ) {
          return null;
        }
        const assigned = assignments.get(experiment);
        if (assigned === undefined) {
          return null;
        }
        experiments.reportExposure(experiment, assigned);
        return assigned;
      });
    },
    exposure(experiment, variation) {
      experiments.reportExposure(experiment, variation);
    },
  };
}
