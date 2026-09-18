import {
  Context,
  Controller,
  Get,
  Parameter,
  type RequestContext,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { AuthTenantMember } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { MarketingEventsModel } from "@/db";
import { computeFunnelResults } from "@/services/funnels";
import { parsePeriodDays, periodStart } from "@/services/period";
import { requireTenantFunnel } from "@/services/tenant-funnel";
import { API_BASE_PATH } from "@/types/constants";

/**
 * Read-time funnel results — the per-arm experiment read included when the
 * row carries one; definitions CRUD lives on the funnels DataController
 * (data-api/funnels.ts). Results are computed over the raw event window so a
 * definition edit re-reads history instead of losing it.
 */
export class FunnelsController extends Controller(`${API_BASE_PATH}/funnels`) {
  @Get("/:id/results")
  async results(
    @AuthTenantMember() _user: User,
    @Parameter("id") id: string,
    @Context() context: RequestContext,
    @Parameter("period", "query") period?: string,
  ) {
    const funnel = await requireTenantFunnel(context, id);
    const days = parsePeriodDays(period);
    const results = await computeFunnelResults(
      GetModel(MarketingEventsModel, getRequestTenantId(context)),
      funnel,
      periodStart(days),
      new Date(),
    );
    return { funnel, ...results };
  }
}
