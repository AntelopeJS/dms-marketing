import type { BannerContent } from "@antelopejs/interface-dms/base/banner";
import type { CellSubline } from "@antelopejs/interface-dms/base/table-view/column-display";
import type { ComposedText } from "@antelopejs/interface-dms/base/types/composed-text";
import { MARKETING_MODULE_PATH } from "@/types/constants";
import { deltaTone, percentText } from "./composed";
import type { FunnelSummaryRow } from "./funnel-report";

const ROW_PREFIX = "$page.marketing.funnels.row.";
const WINNER_PREFIX = "$page.marketing.funnels.winner.";
const COMPOSE_PREFIX = "$page.marketing.compose.";

/** The arm a leading variation is named by: the first after the control. */
const LEADER_LETTER = "B";

/** A row of the funnels table, the shape `TableView.fromSource` lists. */
export interface FunnelTableRow {
  _id: string;
  name: string;
  /** Under the name: the steps and window, or the A/B test's state. */
  detail: ComposedText;
  /** First step → … → last step. */
  steps: string;
  kind: FunnelSummaryRow["kind"];
  entered: number;
  conversion: number | null;
  conversionText: ComposedText | string;
  /** Under the conversion: its change, or the test's run. */
  comparison: CellSubline | null;
  status: string | null;
}

function detailOf(row: FunnelSummaryRow): ComposedText {
  const experiment = row.experiment;
  if (!experiment) {
    return {
      key: `${ROW_PREFIX}plain`,
      params: { steps: row.steps.length, hours: row.windowHours },
    };
  }
  if (experiment.status === "draft") {
    return {
      key: `${ROW_PREFIX}draft`,
      params: {
        key: experiment.key,
        count: { type: "count", value: experiment.variations },
      },
    };
  }
  const leader = experiment.leader;
  if (!leader) {
    return { key: `${ROW_PREFIX}no_leader`, params: { key: experiment.key } };
  }
  return {
    key: `${ROW_PREFIX}leader`,
    params: {
      key: experiment.key,
      letter: LEADER_LETTER,
      lift: percentText(leader.uplift) as ComposedText,
    },
  };
}

function stepsOf(row: FunnelSummaryRow): string {
  const values = row.steps.map((step) => step.value);
  if (values.length <= 3) {
    return values.join(" → ");
  }
  return `${values[0]} → +${values.length - 2} → ${values.at(-1)}`;
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
  if (experiment) {
    return null;
  }
  if (row.deltaPoints === null) {
    return row.conversion === null
      ? null
      : { text: "$page.marketing.common.new", tone: "muted" };
  }
  const rounded = Math.round(row.deltaPoints * 10) / 10;
  const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "±";
  const tone = deltaTone(row.deltaPoints);
  return {
    text: {
      key: `${COMPOSE_PREFIX}signed`,
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
): { results: FunnelTableRow[]; total: number } {
  const results = rows
    .filter((row) => !kind || row.kind === kind)
    .map((row) => ({
      _id: row.id,
      name: row.name,
      detail: detailOf(row),
      steps: stepsOf(row),
      kind: row.kind,
      entered: row.entered,
      conversion: row.conversion,
      conversionText: percentText(row.conversion),
      comparison: comparisonOf(row),
      status: row.experiment?.status ?? null,
    }));
  return { results, total: results.length };
}

/**
 * The banner above the funnels table, for a stock `Banner`: the running test
 * that reached significance with its leader ahead, or `null`.
 */
export function winnerBanner(rows: FunnelSummaryRow[]): BannerContent | null {
  const winner = rows.find(
    (row) =>
      row.experiment?.status === "running" &&
      row.experiment.leader?.significant &&
      row.experiment.leader.uplift > 0,
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
        confidence: percentText(leader.confidence ?? 0) as ComposedText,
        exposed: { type: "number", value: experiment.exposed },
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
