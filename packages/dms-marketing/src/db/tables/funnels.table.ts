import {
  CreationTime,
  Field,
  Index,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const funnelsTableName = "marketing_funnels";

export interface FunnelStep {
  kind: "url" | "custom";
  value: string;
}

export const EXPERIMENT_STATUSES = ["draft", "running", "stopped"] as const;
export type ExperimentStatus = (typeof EXPERIMENT_STATUSES)[number];

/** One arm of an experiment. Weights are relative; assignment normalizes. */
export interface ExperimentVariation {
  key: string;
  weight: number;
}

/**
 * One stretch of time the split served traffic, epoch milliseconds. A stopped
 * split that is started again appends a run rather than reopening the last
 * one, so the gap between them counts for nothing; only the last run can be
 * open (`stoppedAt` null). Milliseconds rather than `Date` because the write
 * path re-serializes the row through JSON, which would store a Date as a
 * string.
 */
export interface ExperimentRun {
  startedAt: number;
  stoppedAt: number | null;
}

/**
 * The A/B facet of a funnel: the slug page code asks variations for (unique
 * per website), the lifecycle and the arms — the first one is the control.
 * Assignment is computed server-side from the anonymous visitor hash
 * (services/experiments/assign); exposures come back through collect as
 * "exposure" events. `key` and `variations` are frozen once the status
 * leaves "draft": editing them mid-run moves the bucket boundaries and
 * silently reassigns visitors.
 */
export interface FunnelExperiment {
  key: string;
  status: ExperimentStatus;
  variations: ExperimentVariation[];
  /**
   * Every stretch of time the split served traffic, oldest first. The results
   * are read over their union (services/funnels/results), which is what makes
   * a stopped split's numbers final and what keeps a resumed one from
   * counting the pause. Written by the lifecycle transitions alone and never
   * read off a request body, or a caller could re-open the window of a split
   * it has no other way to feed. Empty exactly while the split is a draft:
   * the only way out of draft is `running`, which appends a run.
   */
  runs: ExperimentRun[];
}

/**
 * No `tenantId` column: the table lives in the per-tenant schema, so the
 * database instance itself is the tenant boundary. The steps stay editable
 * whatever the experiment's status — results are computed read-time, so a
 * change re-reads history and never touches assignment.
 */
@RegisterTable(funnelsTableName, TENANT_SCHEMA_NAME)
export class Funnel extends Table {
  @Index()
  @Field("string")
  declare websiteId: string;

  @Field("string")
  declare name: string;

  @Field(["any"])
  declare steps: FunnelStep[];

  /** Max delay between first and last step for a session to convert. */
  @Field("number")
  declare conversionWindowMs: number;

  /** Null on a plain funnel. */
  @Field("any")
  declare experiment: FunnelExperiment | null;

  @CreationTime()
  @Field("date")
  declare createdAt: Date;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
