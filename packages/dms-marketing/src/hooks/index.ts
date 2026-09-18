import { GetModel } from "@antelopejs/interface-database-decorators";
import type { TenantDataExportContribution } from "@antelopejs/interface-dms/hooks";
import { Hook, RegisterHook } from "@antelopejs/interface-dms/hooks";
import {
  FunnelsModel,
  MarketingEventsModel,
  MarketingSessionsModel,
  PageSnapshotsModel,
  WebsiteStatisticsModel,
  WebsitesModel,
} from "@/db";
import { MARKETING_MODULE_ID } from "@/types/constants";

/**
 * Every marketing model living in the per-tenant schema — the set both hooks
 * walk. Events, sessions and page snapshots are deleted with the rest but
 * excluded from the export: retention-bounded captures, not the durable data
 * a workspace owns.
 */
const TENANT_MODELS: ReadonlyArray<Parameters<typeof GetModel>[0]> = [
  MarketingEventsModel,
  MarketingSessionsModel,
  PageSnapshotsModel,
  WebsiteStatisticsModel,
  FunnelsModel,
];

async function purgeTenantMarketingData(tenantId: string): Promise<void> {
  for (const modelClass of TENANT_MODELS) {
    await GetModel(modelClass, tenantId).table.delete().run();
  }
  // Last: while websites rows exist, a re-run of the hook still finds the
  // tenant (the prune iterates tenants through this very table).
  await GetModel(WebsitesModel).deleteByTenant(tenantId);
}

async function exportTenantMarketingData(
  tenantId: string,
): Promise<TenantDataExportContribution> {
  const [websites, funnels, statistics] = await Promise.all([
    GetModel(WebsitesModel).getByTenant(tenantId),
    GetModel(FunnelsModel, tenantId).getAll(),
    GetModel(WebsiteStatisticsModel, tenantId).getAll(),
  ]);
  return {
    moduleId: MARKETING_MODULE_ID,
    data: { websites, funnels, statistics },
  };
}

/**
 * Tenant lifecycle contract: deleting a workspace must not leave tracking
 * data behind, and a data export must include what marketing holds. Called
 * from `construct()`, before any tenant can be deleted or exported.
 */
export function registerMarketingHookListeners(): void {
  RegisterHook(Hook.TENANT_DELETED, async (tenantId: string) => {
    await purgeTenantMarketingData(tenantId);
    return undefined;
  });
  RegisterHook(Hook.TENANT_DATA_EXPORT, exportTenantMarketingData);
}
