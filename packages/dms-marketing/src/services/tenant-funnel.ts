import { HTTPResult, type RequestContext } from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { FunnelsModel } from "@/db";
import type { Funnel } from "@/db/tables/funnels.table";
import { HTTP_NOT_FOUND } from "@/types/constants";

const FUNNEL_NOT_FOUND_MESSAGE = "$page.marketing.errors.funnel_not_found";

/**
 * Funnel of the caller's tenant, or 404. Funnels live in the per-tenant
 * schema, so the lookup itself is the ownership check: another tenant's id
 * simply does not exist in this instance, and answers exactly like a missing
 * one — same anti-probing shape as requireTenantWebsite.
 */
export async function requireTenantFunnel(
  context: RequestContext,
  id: string,
): Promise<Funnel> {
  const funnel = await GetModel(FunnelsModel, getRequestTenantId(context)).get(
    id,
  );
  if (!funnel) {
    throw new HTTPResult(HTTP_NOT_FOUND, FUNNEL_NOT_FOUND_MESSAGE);
  }
  return funnel;
}
