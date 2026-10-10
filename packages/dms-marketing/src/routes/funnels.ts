import {
  Context,
  Controller,
  Get,
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
import { z } from "zod";
import { FunnelsModel } from "@/db";
import type { Funnel } from "@/db/tables/funnels.table";
import { resolveContextWebsite } from "@/services/context";
import {
  funnelResultsIn,
  funnelSuggestions,
  type FunnelSummaryRow,
  summarizeFunnel,
} from "@/services/funnel-report";
import { funnelTablePayload, winnerBanner } from "@/services/funnels-table";
import {
  periodQueryOf,
  resolveCompareWindow,
  resolveQueryWindow,
} from "@/services/period";
import { queryString } from "@/services/query-param";
import { requireTenantFunnel } from "@/services/tenant-funnel";
import {
  API_BASE_PATH,
  MAX_CONVERSION_WINDOW_HOURS,
  MS_PER_HOUR,
} from "@/types/constants";
import { parseFunnelSteps } from "@/utils/funnel-steps-type";

const INVALID_STEPS_MESSAGE = "$page.marketing.errors.invalid_steps";

const previewSchema = z.object({
  steps: z.unknown(),
  conversionWindowHours: z.number().positive().max(MAX_CONVERSION_WINDOW_HOURS),
});

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
): Promise<FunnelSummaryRow[]> {
  const site = await resolveContextWebsite(context, user, website);
  const query = periodQueryOf(context.url);
  const window = resolveQueryWindow(query);
  const compare = resolveCompareWindow(query);
  const funnels = await GetModel(FunnelsModel, site.tenantId).listByWebsite(
    site._id,
  );
  return Promise.all(
    funnels.map((funnel) =>
      summarizeFunnel(funnel, site.tenantId, window, compare),
    ),
  );
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
    return funnelTablePayload(
      await summarizeWebsiteFunnels(context, user, website),
      kind,
    );
  }

  /** The test ready to decide, for the stock `Banner` above the table. */
  @Get("/winner")
  async winner(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    return winnerBanner(await summarizeWebsiteFunnels(context, user, website));
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
      steps: parseFunnelSteps(data.steps),
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

  @Get("/:id/results")
  async results(
    @AuthTenantMember() _user: User,
    @Parameter("id") id: string,
    @Context() context: RequestContext,
  ) {
    const funnel = await requireTenantFunnel(context, id);
    const tenantId = getRequestTenantId(context);
    const query = periodQueryOf(context.url);
    const compare = resolveCompareWindow(query);
    const [results, previous] = await Promise.all([
      funnelResultsIn(funnel, tenantId, resolveQueryWindow(query)),
      compare && !funnel.experiment
        ? funnelResultsIn(funnel, tenantId, compare)
        : Promise.resolve(null),
    ]);
    return {
      funnel,
      ...results,
      previous: previous?.computation ?? null,
    };
  }
}
