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
  experimentVerdict,
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
  funnelDeleteConfirmation,
  funnelTablePayload,
  winnerBanner,
} from "@/services/funnels-table";
import {
  type ComparisonKind,
  comparisonKindOf,
  periodQueryOf,
  type QueryWindow,
  resolveCompareWindow,
  resolveQueryWindow,
  trailingWindow,
} from "@/services/period";
import { queryString, type QueryParameter } from "@/services/query-param";
import { requireTenantFunnel } from "@/services/tenant-funnel";
import {
  API_BASE_PATH,
  HTTP_BAD_REQUEST,
  MAX_CONVERSION_WINDOW_HOURS,
  MS_PER_HOUR,
} from "@/types/constants";
import { parseFunnelSteps } from "@/utils/funnel-steps-type";
import type { JsonBody } from "@/types/json";

const INVALID_STEPS_MESSAGE = "$page.marketing.errors.invalid_steps";
/**
 * Days the builder reads its suggestions and preview over: it has no period
 * of its own.
 */
const BUILDER_WINDOW_DAYS = 30;

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
  /** What the changes are measured against, as their labels name it. */
  comparison: ComparisonKind;
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
  website: QueryParameter,
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
  return { rows, coverage, comparison: comparisonKindOf(query) };
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
    const { rows, comparison } = await summarizeWebsiteFunnels(
      context,
      user,
      website,
    );
    return funnelTablePayload(rows, kind, comparison);
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
    const { rows, coverage, comparison } = await summarizeWebsiteFunnels(
      context,
      user,
      website,
    );
    return winnerBanner(rows, coverage, comparison);
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
    return funnelSuggestions(site, trailingWindow(BUILDER_WINDOW_DAYS));
  }

  /** Scores a definition being edited, without saving it. */
  @Post("/preview")
  async preview(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @JSONBody() body: JsonBody,
    @Parameter("website", "query") website?: string,
  ) {
    const data = assertValidation(
      body,
      // oxlint-disable-next-line typescript/unbound-method -- zod v3 binds `parse` to its schema in the ZodType constructor, so the reference passed here is not actually unbound.
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
      trailingWindow(BUILDER_WINDOW_DAYS),
    );
    return { computation: results.computation, truncated: results.truncated };
  }

  /**
   * The delete confirmation of the list's rows and of the funnel's page
   * (`funnelDeleteConfirmation`).
   */
  @Get("/:id/delete-confirmation")
  async deleteConfirmation(
    @AuthTenantMember() _user: User,
    @Parameter("id") id: string,
    @Context() context: RequestContext,
  ): Promise<ConfirmDialog> {
    return funnelDeleteConfirmation(await requireTenantFunnel(context, id));
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
      verdict: experimentVerdict(results),
      previous: previous?.computation ?? null,
      comparison: compare ? comparisonKindOf(query) : null,
      coverage,
    };
  }
}
