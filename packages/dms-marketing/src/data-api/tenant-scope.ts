import type { RequestContext } from "@antelopejs/interface-api";
import type { DataControllerCallback } from "@antelopejs/interface-data-api";
import type { Parameters } from "@antelopejs/interface-data-api/components";
import type { FilterValue } from "@antelopejs/interface-data-api/metadata";
import { TableViewRoutes } from "@antelopejs/interface-dms/base";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";

/**
 * Column-scoping wrappers for the ONE marketing table that cannot live in the
 * per-tenant schema: websites, the global `websiteId → tenantId` bridge the
 * anonymous collect path resolves against. Every other table gets its
 * isolation structurally (tenant instance = boundary) and needs none of this.
 */

/** Ownership gate of one table (row of the caller's tenant, or 404). */
export type TenantGate = (ctx: RequestContext, id: string) => Promise<unknown>;

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
      // "is" is the compare mode the DMS DataTypes register (and the one the
      // dms-ui frontend sends); interface-data-api's Comparison type does not
      // know it, hence the double cast — "eq" would typecheck but resolves to
      // no registered mode and would match nothing.
      const params: Parameters.ListParameters = {
        ...listParams,
        filters: {
          ...listParams?.filters,
          // "is" is not in interface-data-api's Comparison type; see above.
          // oxlint-disable-next-line anti-slop/no-chained-type-assertions
          tenantId: [getRequestTenantId(ctx), "is"] as unknown as FilterValue,
        },
      };
      return base.func.call(this, ctx, params, ...rest);
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
      return base.func.call(this, ctx, params, ...rest);
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
