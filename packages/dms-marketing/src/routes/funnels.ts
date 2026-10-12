import {
  Context,
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assertValidation } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { AuthTenantMember } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import type { ConfirmDialog } from "@antelopejs/interface-dms/base/types/confirm-dialog";
import { z } from "zod";
import { FunnelsModel } from "@/db";
import type { Funnel } from "@/db/tables/funnels.table";
import { resolveContextWebsite } from "@/services/context";
import {
  coversWindow,
  funnelResultsIn,
  funnelSuggestions,
  funnelTemplates,
  type FunnelSummaryRow,
  rawCoverageStart,
  readsPeriod,
  summarizeFunnel,
} from "@/services/funnel-report";
import {
  type FunnelCoverage,
  funnelRowContext,
  funnelTablePayload,
  winnerBanner,
} from "@/services/funnels-table";
import {
  periodQueryOf,
  type QueryWindow,
  resolveCompareWindow,
  resolveQueryWindow,
} from "@/services/period";
import { queryString } from "@/services/query-param";
import { requireTenantFunnel } from "@/services/tenant-funnel";
import {
  API_BASE_PATH,
  HTTP_BAD_REQUEST,
  MAX_CONVERSION_WINDOW_HOURS,
  MS_PER_HOUR,
} from "@/types/constants";
import { parseFunnelSteps } from "@/utils/funnel-steps-type";

const INVALID_STEPS_MESSAGE = "$page.marketing.errors.invalid_steps";
const DELETE_PREFIX = "$page.marketing.funnel.delete.";

const previewSchema = z.object({
  steps: z.unknown(),
  conversionWindowHours: z.number().positive().max(MAX_CONVERSION_WINDOW_HOURS),
});

/** The draft's steps, or a 400: a step the builder lets through (too long,
 * unknown kind) must not surface as a server error. */
function previewSteps(raw: unknown): Funnel["steps"] {
  try {
    return parseFunnelSteps(raw);
  } catch {
    throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_STEPS_MESSAGE);
  }
}

/**
 * What raw events cover of a period and its comparison. Funnels read raw
 * events only: a comparison window they do not cover would compare a full
 * period with a few days (+1,000 %), so it is dropped, and said.
 */
async function windowsCoverage(
  tenantId: string,
  websiteId: string,
  window: QueryWindow,
  compare: QueryWindow | null,
): Promise<FunnelCoverage> {
  const since = await rawCoverageStart(tenantId, websiteId);
  return {
    since,
    period: since !== null && !coversWindow(window, since),
    previous:
      compare !== null && since !== null && !coversWindow(compare, since),
  };
}

interface WebsiteFunnels {
  rows: FunnelSummaryRow[];
  coverage: FunnelCoverage;
}

/**
 * Read-time funnel results — the per-arm experiment read included when the
 * row carries one; definitions CRUD lives on the funnels DataController
 * (data-api/funnels.ts). Results are computed over the raw event window so a
 * definition edit re-reads history instead of losing it.
 */
/** Every funnel of the context's website, summarized over the request's period. */
async function summarizeWebsiteFunnels(
  context: RequestContext,
  user: User,
  website: unknown,
): Promise<WebsiteFunnels> {
  const site = await resolveContextWebsite(context, user, website);
  const query = periodQueryOf(context.url);
  const window = resolveQueryWindow(query);
  const compare = resolveCompareWindow(query);
  const [funnels, coverage] = await Promise.all([
    GetModel(FunnelsModel, site.tenantId).listByWebsite(site._id),
    windowsCoverage(site.tenantId, site._id, window, compare),
  ]);
  const comparable =
    coverage.previous || coverage.since === null ? null : compare;
  const rows = await Promise.all(
    funnels.map((funnel) =>
      summarizeFunnel(funnel, site.tenantId, window, comparable),
    ),
  );
  return { rows, coverage };
}

export class FunnelsController extends Controller(`${API_BASE_PATH}/funnels`) {
  /**
   * The funnels table (`TableView.fromSource`): one row per funnel with its
   * entered sessions, conversion and change over the page's period, or its
   * A/B test's state; `filter_kind` narrows to funnels or tests.
   */
  @Get("/rows")
  async rows(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("filter_kind", "query") kindFilter?: string,
    @Parameter("website", "query") website?: string,
  ) {
    const kind = queryString(kindFilter)?.replace(/^is:/, "");
    const { rows } = await summarizeWebsiteFunnels(context, user, website);
    return funnelTablePayload(
      rows,
      kind,
      funnelRowContext(periodQueryOf(context.url), queryString(website)),
    );
  }

  /**
   * The stock `Banner` above the table: the test ready to decide, else the
   * days of the period raw events do not cover.
   */
  @Get("/winner")
  async winner(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    const { rows, coverage } = await summarizeWebsiteFunnels(
      context,
      user,
      website,
    );
    return winnerBanner(rows, coverage);
  }

  /** Funnels the site's own journeys suggest, for the first-run state. */
  @Get("/templates")
  async templates(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    const site = await resolveContextWebsite(context, user, website);
    return funnelTemplates(
      site,
      resolveQueryWindow(periodQueryOf(context.url)),
    );
  }

  /** Pages and events a step can match, for the builder's autocomplete. */
  @Get("/suggestions")
  async suggestions(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    const site = await resolveContextWebsite(context, user, website);
    return funnelSuggestions(
      site,
      resolveQueryWindow(periodQueryOf(context.url)),
    );
  }

  /** Scores a definition being edited, without saving it. */
  @Post("/preview")
  async preview(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @JSONBody() body: unknown,
    @Parameter("website", "query") website?: string,
  ) {
    const data = assertValidation(
      body,
      // zod v3 binds `parse` to its schema in the ZodType constructor, so the
      // reference passed here is not actually unbound.
      // oxlint-disable-next-line typescript/unbound-method
      previewSchema.parse,
      () => INVALID_STEPS_MESSAGE,
    );
    const site = await resolveContextWebsite(context, user, website);
    const draft = {
      websiteId: site._id,
      steps: previewSteps(data.steps),
      conversionWindowMs: data.conversionWindowHours * MS_PER_HOUR,
      experiment: null,
    } as Funnel;
    const results = await funnelResultsIn(
      draft,
      site.tenantId,
      resolveQueryWindow(periodQueryOf(context.url)),
    );
    return { computation: results.computation, truncated: results.truncated };
  }

  /**
   * The list's delete confirmation, worded for the row: a running test says
   * it stops serving variations, and the name must be typed.
   */
  @Get("/:id/delete-confirmation")
  async deleteConfirmation(
    @AuthTenantMember() _user: User,
    @Parameter("id") id: string,
    @Context() context: RequestContext,
  ): Promise<ConfirmDialog> {
    const funnel = await requireTenantFunnel(context, id);
    const running = funnel.experiment?.status === "running";
    return {
      title: `${DELETE_PREFIX}title`,
      description: `${DELETE_PREFIX}${running ? "description_running" : "description"}`,
      params: { name: funnel.name, key: funnel.experiment?.key ?? "" },
      color: "error",
      icon: "i-ph-trash",
      confirmLabel: `${DELETE_PREFIX}confirm`,
      confirmText: funnel.name,
      impact: running
        ? [{ icon: "i-ph-stop", label: `${DELETE_PREFIX}impact_running` }]
        : undefined,
    };
  }

  @Get("/:id/results")
  async results(
    @AuthTenantMember() _user: User,
    @Parameter("id") id: string,
    @Context() context: RequestContext,
  ) {
    const funnel = await requireTenantFunnel(context, id);
    const tenantId = getRequestTenantId(context);
    const query = periodQueryOf(context.url);
    const window = resolveQueryWindow(query);
    const compare = readsPeriod(funnel) ? resolveCompareWindow(query) : null;
    const coverage = await windowsCoverage(
      tenantId,
      funnel.websiteId,
      window,
      compare,
    );
    const [results, previous] = await Promise.all([
      funnelResultsIn(funnel, tenantId, window),
      compare && !coverage.previous && coverage.since !== null
        ? funnelResultsIn(funnel, tenantId, compare)
        : Promise.resolve(null),
    ]);
    return {
      funnel,
      ...results,
      previous: previous?.computation ?? null,
      coverage,
    };
  }
}
