import type { RequestContext } from "@antelopejs/interface-api";
import type { DataControllerCallback } from "@antelopejs/interface-data-api";
import type { Parameters } from "@antelopejs/interface-data-api/components";
import type { FilterValue } from "@antelopejs/interface-data-api/metadata";
import { TableViewRoutes } from "@antelopejs/interface-dms/base";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import type { Website } from "@/db/tables/websites.table";

/**
 * Column-scoping wrappers for the ONE marketing table that cannot live in the
 * per-tenant schema: websites, the global `websiteId → tenantId` bridge the
 * anonymous collect path resolves against. Every other table gets its
 * isolation structurally (tenant instance = boundary) and needs none of this.
 */

/**
 * The compare mode the DMS data types register for a hidden filter and the
 * dms-ui frontend sends. interface-data-api's `Comparison` does not list it,
 * and `"eq"` would typecheck and match nothing.
 */
const TENANT_FILTER_MODE: string = "is";

/** Ownership gate of one table (row of the caller's tenant, or 404). */
export type TenantGate = (ctx: RequestContext, id: string) => Promise<Website>;

/**
 * Forces the caller's tenant onto the hidden `tenantId` filter of a
 * list-shaped route (list/count/select): rows of other tenants never leave
 * the server, whatever filters the client sends. The scoped table must carry
 * a `tenantId` field registered with HiddenStringFilter.
 */
function withTenantScope(base: DataControllerCallback): DataControllerCallback {
  return {
    ...base,
    func: async function (
      this: unknown,
      ctx: RequestContext,
      listParams: Parameters.ListParameters,
      ...rest: unknown[]
    ) {
      const params: Parameters.ListParameters = {
        ...listParams,
        filters: {
          ...listParams?.filters,
          tenantId: [
            getRequestTenantId(ctx),
            TENANT_FILTER_MODE,
          ] as FilterValue,
        },
      };
      const answer: unknown = await base.func.call(this, ctx, params, ...rest);
      return answer;
    },
  };
}

/**
 * Gates an id-addressed `get` route behind a tenant ownership check (the
 * list filter cannot protect direct reads): `gate` throws the anti-probing
 * 404 when the row is missing or belongs to another tenant.
 */
function withTenantGate(
  gate: TenantGate,
): (base: DataControllerCallback) => DataControllerCallback {
  return (base) => ({
    ...base,
    func: async function (
      this: unknown,
      ctx: RequestContext,
      params: Parameters.GetParameters,
      ...rest: unknown[]
    ) {
      await gate(ctx, params.id);
      const answer: unknown = await base.func.call(this, ctx, params, ...rest);
      return answer;
    },
  });
}

/**
 * Every read route of a TableView, tenant-forced: the list shapes take the
 * caller's tenant as a hidden filter, the id-addressed `get` goes through the
 * ownership gate. Built as a whole because forgetting one wrapper fails
 * silently — a table gets the complete set or none of it.
 */
export function tenantScopedReadRoutes(gate: TenantGate) {
  return {
    get: withTenantGate(gate)(TableViewRoutes.Get),
    list: withTenantScope(TableViewRoutes.List),
    count: withTenantScope(TableViewRoutes.Count),
    select: {
      ...TableViewRoutes.Select,
      callback: withTenantScope(TableViewRoutes.Select.callback),
    },
  };
}
