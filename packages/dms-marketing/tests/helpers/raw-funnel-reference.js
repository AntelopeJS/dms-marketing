const { normalizedWeights } = require("../../dist/services/experiments/assign");
const {
  comparisonAlpha,
  liftInterval,
  sampleRatioCheck,
  twoProportionTest,
} = require("../../dist/services/experiments/stats");
const { stepPathMatcher } = require("../../dist/services/funnels/step-path");
const {
  MIN_DECISION_CONVERSIONS,
  MIN_DECISION_DAYS,
  MS_PER_DAY,
} = require("../../dist/types/constants");
const { isObject, isString } = require("../../dist/utils/guards");

/** @typedef {import("../../dist/db").MarketingEventsModel} EventsModel */
/** @typedef {import("../../dist/db").FunnelStep} FunnelStep */
/** @typedef {import("../../dist/db").FunnelExperiment} FunnelExperiment */
/** @typedef {Pick<import("../../dist/db").Funnel, "websiteId" | "steps" | "conversionWindowMs" | "experiment">} ReadableFunnel */
/** @typedef {{ sessionId: string, kind: string, url: string, name?: string, data?: unknown, timestamp: Date }} RawEvent */
/** @typedef {{ since: Date, until: Date }} EventWindow */
/** @typedef {{ totalSessions: number, events: number, steps: { step: FunnelStep, sessions: number, conversionRate: number, matches: number }[] }} FunnelComputation */

const FUNNEL_FIELDS = ["sessionId", "kind", "url", "name"];

/**
 * @param {EventsModel} events
 * @param {string} websiteId
 * @param {EventWindow} window
 * @param {string[]} kinds
 * @returns {Promise<RawEvent[]>}
 */
function readRaw(events, websiteId, window, kinds) {
  return events.queryRange({
    websiteIds: [websiteId],
    since: window.since,
    until: window.until,
    kinds,
    limit: Number.MAX_SAFE_INTEGER,
    fields: [...FUNNEL_FIELDS, "data"],
  });
}

/**
 * @param {FunnelExperiment} experiment
 * @param {Date} until
 * @returns {EventWindow[] | null}
 */
function runWindows(experiment, until) {
  if (experiment.status === "draft") {
    return null;
  }
  return experiment.runs.map((run) => ({
    since: new Date(run.startedAt),
    until: run.stoppedAt === null ? until : new Date(run.stoppedAt),
  }));
}

/**
 * @param {EventWindow[]} runs
 * @param {ReadableFunnel} funnel
 * @param {Date} until
 * @returns {EventWindow}
 */
function readWindow(runs, funnel, until) {
  const since = Math.min(...runs.map((run) => run.since.getTime()));
  const last = Math.max(...runs.map((run) => run.until.getTime()));
  return {
    since: new Date(since),
    until: new Date(
      Math.min(last + funnel.conversionWindowMs, until.getTime()),
    ),
  };
}

/**
 * @param {RawEvent[]} events
 * @param {EventWindow[]} runs
 */
function withinRuns(events, runs) {
  const bounds = runs.map((run) => [run.since.getTime(), run.until.getTime()]);
  return events.filter((event) => {
    if (event.kind !== "exposure") {
      return true;
    }
    const at = event.timestamp.getTime();
    return bounds.some(([since, until]) => at >= since && at <= until);
  });
}

/**
 * @template {{ sessionId: string }} T
 * @param {T[]} events
 * @returns {Map<string, T[]>}
 */
function groupBySession(events) {
  /** @type {Map<string, T[]>} */
  const sessions = new Map();
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

/**
 * @param {FunnelStep} step
 * @returns {(event: RawEvent) => boolean}
 */
function stepMatcher(step) {
  if (step.kind === "custom") {
    return (event) => event.kind === "custom" && event.name === step.value;
  }
  const matchesPath = stepPathMatcher(step.value);
  return (event) => event.kind === "pageview" && matchesPath(event.url);
}

/**
 * @param {RawEvent[]} events
 * @param {Pick<ReadableFunnel, "steps" | "conversionWindowMs">} funnel
 * @param {((event: RawEvent) => boolean)[]} matchers
 */
function sessionProgress(events, funnel, matchers) {
  let reached = 0;
  /** @type {number | undefined} */
  let enteredAt;
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
 * @param {Pick<ReadableFunnel, "steps" | "conversionWindowMs">} funnel
 * @param {Iterable<RawEvent[]>} sessions
 * @returns {FunnelComputation}
 */
function computeFunnelOverSessions(funnel, sessions) {
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

/**
 * @param {RawEvent[]} events
 * @param {FunnelExperiment} experiment
 * @returns {Map<string, string | null>}
 */
function variationBySession(events, experiment) {
  const armKeys = new Set(experiment.variations.map((v) => v.key));
  /** @type {Map<string, string | null>} */
  const assignments = new Map();
  for (const event of events) {
    if (event.kind !== "exposure" || event.name !== experiment.key) {
      continue;
    }
    const data = event.data;
    const variation =
      isObject(data) && "variation" in data ? data.variation : undefined;
    if (!isString(variation) || !armKeys.has(variation)) {
      continue;
    }
    const existing = assignments.get(event.sessionId);
    if (existing === undefined) {
      assignments.set(event.sessionId, variation);
    } else if (existing !== null && existing !== variation) {
      assignments.set(event.sessionId, null);
    }
  }
  return assignments;
}

/**
 * @param {RawEvent[]} events
 * @param {Map<string, string | null>} assignments
 * @param {string} key
 */
function armEvents(events, assignments, key) {
  return events.filter(
    (event) =>
      event.kind !== "exposure" && assignments.get(event.sessionId) === key,
  );
}

/**
 * @param {RawEvent[]} events
 * @param {Pick<ReadableFunnel, "steps" | "conversionWindowMs">} goal
 * @param {FunnelExperiment} experiment
 * @param {number} servedMs
 */
function computeExperimentResults(events, goal, experiment, servedMs) {
  const assignments = variationBySession(events, experiment);
  const counts = experiment.variations.map((variation) => {
    const computation = computeFunnelOverSessions(
      goal,
      groupBySession(armEvents(events, assignments, variation.key)).values(),
    );
    const lastStep = computation.steps[computation.steps.length - 1];
    return {
      key: variation.key,
      exposed: [...assignments.values()].filter((arm) => arm === variation.key)
        .length,
      conversions: lastStep?.sessions ?? 0,
      computation,
    };
  });
  const control = counts[0];
  const controlRate =
    control.exposed > 0 ? control.conversions / control.exposed : 0;
  const alpha = comparisonAlpha(counts.length);
  const variations = counts.map((arm, index) => {
    const rate = arm.exposed > 0 ? arm.conversions / arm.exposed : 0;
    const isControl = index === 0;
    const test = isControl
      ? { pValue: null, significant: null }
      : twoProportionTest(
          control.conversions,
          control.exposed,
          arm.conversions,
          arm.exposed,
          alpha,
        );
    const interval =
      test.pValue === null || controlRate === 0
        ? null
        : liftInterval(
            control.conversions,
            control.exposed,
            arm.conversions,
            arm.exposed,
            alpha,
          );
    return {
      key: arm.key,
      exposedSessions: arm.exposed,
      computation: arm.computation,
      conversionRate: rate,
      conversions: arm.conversions,
      uplift:
        isControl || controlRate === 0
          ? null
          : (rate - controlRate) / controlRate,
      upliftLow: interval?.low ?? null,
      upliftHigh: interval?.high ?? null,
      pValue: test.pValue,
      significant: test.significant,
    };
  });
  const days = servedMs / MS_PER_DAY;
  return {
    control: control.key,
    alpha,
    variations,
    decision: {
      days,
      minDays: MIN_DECISION_DAYS,
      minConversions: MIN_DECISION_CONVERSIONS,
      ready:
        days >= MIN_DECISION_DAYS &&
        counts.every((arm) => arm.conversions >= MIN_DECISION_CONVERSIONS),
    },
    srm: sampleRatioCheck(
      counts.map((arm) => arm.exposed),
      normalizedWeights(experiment.variations),
    ),
  };
}

/** @param {EventWindow[]} runs */
function servedMs(runs) {
  return runs.reduce(
    (sum, run) => sum + Math.max(0, run.until.getTime() - run.since.getTime()),
    0,
  );
}

/**
 * @param {EventsModel} events
 * @param {ReadableFunnel} funnel
 * @param {EventWindow} window
 */
async function referenceFunnelResults(events, funnel, window) {
  const experiment = funnel.experiment;
  const runs = experiment ? runWindows(experiment, window.until) : null;
  const read = runs ? readWindow(runs, funnel, window.until) : window;
  const kinds = runs
    ? ["pageview", "custom", "exposure"]
    : ["pageview", "custom"];
  const raw = await readRaw(events, funnel.websiteId, read, kinds);
  const usable = runs ? withinRuns(raw, runs) : raw;
  const reported = runs
    ? {
        since: Math.min(...runs.map((run) => run.since.getTime())),
        until: Math.max(...runs.map((run) => run.until.getTime())),
      }
    : { since: read.since.getTime(), until: read.until.getTime() };
  return {
    computation: computeFunnelOverSessions(
      funnel,
      groupBySession(usable).values(),
    ),
    experiment:
      runs && experiment
        ? computeExperimentResults(usable, funnel, experiment, servedMs(runs))
        : undefined,
    window: reported,
  };
}

/**
 * @param {Map<string, number>} counts
 * @param {string} key
 */
function increment(counts, key) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** @param {Map<string, number>} counts */
function mostFrequent(counts) {
  /** @type {string | null} */
  let best = null;
  for (const [key, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) {
      best = key;
    }
  }
  return best;
}

/**
 * @param {RawEvent[][]} sessions
 * @param {string} name
 */
function leadPage(sessions, name) {
  /** @type {Map<string, number>} */
  const before = new Map();
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
  return mostFrequent(before);
}

/**
 * @param {EventsModel} events
 * @param {{ _id: string }} website
 * @param {EventWindow} window
 */
async function referenceTemplates(events, website, window) {
  const raw = await readRaw(events, website._id, window, [
    "pageview",
    "custom",
  ]);
  const sessions = [...groupBySession(raw).values()];
  /** @type {Map<string, number>} */
  const sessionsByEvent = new Map();
  /** @type {Map<string, number>} */
  const sessionsByPage = new Map();
  for (const session of sessions) {
    /** @type {Set<string>} */
    const names = new Set();
    /** @type {Set<string>} */
    const pages = new Set();
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
    .slice(0, 2)
    .map(([name]) => name);
  return topEvents.map((name) => {
    const page = leadPage(sessions, name);
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

module.exports = { referenceFunnelResults, referenceTemplates };
