import type { BannerContent } from "@antelopejs/interface-dms/base/banner";
import type {
  CellSubline,
  DefaultDisplays,
} from "@antelopejs/interface-dms/base/table-view/column-display";
import type { ComposedText } from "@antelopejs/interface-dms/base/types/composed-text";
import { MARKETING_MODULE_PATH } from "@/types/constants";
import { deltaTone, percentText } from "./composed";
import type { FunnelSummaryRow } from "./funnel-report";
import { type PeriodQuery, periodDayOf } from "./period";
import { queryString } from "./query-param";

const ROW_PREFIX = "$page.marketing.funnels.row.";
const WINNER_PREFIX = "$page.marketing.funnels.winner.";
const COVERAGE_PREFIX = "$page.marketing.funnels.coverage.";
const COMPOSE_PREFIX = "$page.marketing.compose.";

const LETTER_A = 65;

const KIND_ICONS = { funnel: "i-ph-funnel", ab: "i-ph-flask" } as const;

/** A row of the funnels table, the shape `TableView.fromSource` lists. */
/**
 * The context a table was read in, as the context bar's period selector
 * keeps it in the page URL, which its row actions link with: a preset's name
 * in `period`, or a custom range's days in `from`/`to`. The keys a read
 * leaves out are empty, as the selector reads an empty key as absent.
 */
export interface FunnelRowContext {
  website?: string;
  period?: string;
  from?: string;
  to?: string;
  compare?: string;
}

const CUSTOM_PRESET = "custom";

/** The row context of a read, from the period scope's parameters. */
export function funnelRowContext(
  query: PeriodQuery,
  website: string | undefined,
): FunnelRowContext {
  const preset = queryString(query.preset);
  const custom = preset === CUSTOM_PRESET;
  return {
    website,
    period: custom ? "" : (preset ?? ""),
    from: custom ? (periodDayOf(query.from, "start") ?? "") : "",
    to: custom ? (periodDayOf(query.to, "end") ?? "") : "",
    compare: queryString(query.comparison) ?? "",
  };
}

export interface FunnelTableRow {
  _id: string;
  name: string;
  /** Icon tile of the name: a funnel, or a flask for an A/B test. */
  icon: string;
  /** Under the name: the steps and window, the A/B test's state, or a step
   * the site never sent, in warning. */
  detail: CellSubline;
  /** Each step as a pill: pages outlined, events in the primary tone. */
  steps: DefaultDisplays.PillItem[];
  kind: FunnelSummaryRow["kind"];
  entered: number;
  completed: number;
  conversion: number | null;
  conversionText: ComposedText | string;
  /** Under the conversion: its change, or the test's run. */
  comparison: CellSubline | null;
  status: string | null;
  context: FunnelRowContext;
}

function letter(index: number): string {
  return String.fromCharCode(LETTER_A + index);
}

function signedPercent(value: number): ComposedText {
  return {
    key: `${COMPOSE_PREFIX}signed`,
    params: {
      sign: value > 0 ? "+" : value < 0 ? "−" : "±",
      value: percentText(Math.abs(value)) as ComposedText,
    },
  };
}

function detailOf(row: FunnelSummaryRow): CellSubline {
  if (row.unseenStep) {
    return {
      text: { key: `${ROW_PREFIX}unseen`, params: { step: row.unseenStep } },
      tone: "warning",
    };
  }
  const experiment = row.experiment;
  if (!experiment) {
    return {
      text: {
        key: `${ROW_PREFIX}plain`,
        params: {
          steps: { type: "count", value: row.steps.length },
          hours: row.windowHours,
        },
      },
    };
  }
  if (experiment.status === "draft") {
    return {
      text: {
        key: `${ROW_PREFIX}draft`,
        params: {
          key: experiment.key,
          count: { type: "count", value: experiment.variations },
        },
      },
    };
  }
  if (experiment.exposed === 0) {
    return {
      text: { key: `${ROW_PREFIX}no_traffic`, params: { key: experiment.key } },
      tone: experiment.status === "running" ? "warning" : undefined,
    };
  }
  const leader = experiment.leader;
  if (!leader) {
    return {
      text: { key: `${ROW_PREFIX}no_leader`, params: { key: experiment.key } },
    };
  }
  if (leader.uplift <= 0) {
    return {
      text: {
        key: `${ROW_PREFIX}control_leads`,
        params: { key: experiment.key },
      },
    };
  }
  return {
    text: {
      key: `${ROW_PREFIX}leader`,
      params: {
        key: experiment.key,
        letter: letter(leader.index),
        lift: signedPercent(leader.uplift),
      },
    },
  };
}

function stepsOf(row: FunnelSummaryRow): DefaultDisplays.PillItem[] {
  return row.steps.map((step) =>
    step.kind === "custom"
      ? { label: step.value, tone: "primary", variant: "outline" }
      : { label: step.value },
  );
}

const day = (value: number) => ({
  type: "date" as const,
  value,
  format: "day" as const,
});

function comparisonOf(row: FunnelSummaryRow): CellSubline | null {
  const experiment = row.experiment;
  if (experiment?.status === "running" && experiment.since) {
    return {
      text: {
        key: `${ROW_PREFIX}since`,
        params: { date: day(experiment.since) },
      },
      tone: "dimmed",
    };
  }
  if (
    experiment?.status === "stopped" &&
    experiment.since &&
    experiment.until
  ) {
    return {
      text: {
        key: `${COMPOSE_PREFIX}range`,
        params: { from: day(experiment.since), to: day(experiment.until) },
      },
      tone: "dimmed",
    };
  }
  // No comparison window, none raw events cover, or nobody entered either
  // time: no line rather than a "New" a funnel scored on history never is.
  if (row.deltaPoints === null) {
    return null;
  }
  const rounded = Math.round(row.deltaPoints * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  const tone = deltaTone(row.deltaPoints);
  return {
    text: {
      key: `${COMPOSE_PREFIX}delta`,
      params: {
        sign,
        value: {
          key: `${COMPOSE_PREFIX}points`,
          params: { value: { type: "number", value: Math.abs(rounded) } },
        },
      },
    },
    tone: tone === "success" || tone === "error" ? tone : "muted",
  };
}

/** `{ results, total }` for the funnels table, narrowed to one kind. */
export function funnelTablePayload(
  rows: FunnelSummaryRow[],
  kind: string | undefined,
  context: FunnelRowContext = {},
): { results: FunnelTableRow[]; total: number } {
  const results = rows
    .filter((row) => !kind || row.kind === kind)
    .map((row) => ({
      _id: row.id,
      name: row.name,
      icon: KIND_ICONS[row.kind],
      detail: detailOf(row),
      steps: stepsOf(row),
      kind: row.kind,
      entered: row.entered,
      completed: row.completed,
      conversion: row.conversion,
      conversionText: percentText(row.conversion),
      comparison: comparisonOf(row),
      status: row.experiment?.status ?? null,
      context,
    }));
  return { results, total: results.length };
}

/**
 * The running test ready to decide: significant with its leader ahead, a
 * full week served and enough conversions in every arm (see
 * MIN_DECISION_DAYS). Earlier, a significant reading is still noise often
 * enough not to be announced.
 */
function winnerOf(rows: FunnelSummaryRow[]): BannerContent | null {
  const winner = rows.find(
    (row) => row.experiment?.status === "running" && row.experiment.ready,
  );
  const experiment = winner?.experiment;
  const leader = experiment?.leader;
  if (!winner || !experiment || !leader) {
    return null;
  }
  return {
    tone: "success",
    icon: "i-ph-flask",
    title: {
      key: `${WINNER_PREFIX}title`,
      params: {
        name: winner.name,
        lift: percentText(leader.uplift) as ComposedText,
      },
    },
    description: {
      key: `${WINNER_PREFIX}description`,
      params: {
        low: signedPercent(experiment.upliftLow ?? 0),
        high: signedPercent(experiment.upliftHigh ?? 0),
        exposed: { type: "number", value: experiment.exposed },
        days: { type: "count", value: Math.floor(experiment.days) },
      },
    },
    actions: [
      {
        label: `${WINNER_PREFIX}review`,
        to: `${MARKETING_MODULE_PATH}/funnel?id=${encodeURIComponent(winner.id)}`,
        color: "success",
      },
    ],
  };
}

/** What raw events cover of the period and its comparison. */
export interface FunnelCoverage {
  /** First instant covered, null when the site has no raw event at all. */
  since: number | null;
  /** The period starts before it: its first days count nothing. */
  period: boolean;
  /** The comparison window starts before it: the changes are left out. */
  previous: boolean;
}

/** Why the numbers miss days or their comparison, when they do. */
function coverageBanner(coverage: FunnelCoverage): BannerContent | null {
  if (coverage.since === null || (!coverage.period && !coverage.previous)) {
    return null;
  }
  const params = { date: day(coverage.since) };
  return {
    tone: "info",
    size: "sm",
    icon: "i-ph-clock-counter-clockwise",
    title: coverage.period
      ? { key: `${COVERAGE_PREFIX}period_title`, params }
      : `${COVERAGE_PREFIX}previous_title`,
    description: { key: `${COVERAGE_PREFIX}description`, params },
  };
}

/**
 * The banner above the funnels table, for a stock `Banner` that shows one:
 * days of the period raw events do not cover first (every row reads short),
 * then the running test ready to decide, then a comparison left out.
 */
export function winnerBanner(
  rows: FunnelSummaryRow[],
  coverage?: FunnelCoverage,
): BannerContent | null {
  if (coverage?.period) {
    return coverageBanner(coverage);
  }
  return winnerOf(rows) ?? (coverage ? coverageBanner(coverage) : null);
}
