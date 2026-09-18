import type {
  MarketingHeatmapPayload,
  MarketingHeatmapQuery,
} from "@antelopejs/interface-dms-marketing";
import { buildTenantHeatmap } from "@/services/heatmap";

export async function GetClickHeatmap(
  query: MarketingHeatmapQuery,
): Promise<MarketingHeatmapPayload> {
  return buildTenantHeatmap(query);
}
