import type {
  MarketingAnalyticsImport,
  MarketingDeclarationResult,
  MarketingFunnelDeclaration,
  MarketingHeatmapPayload,
  MarketingHeatmapQuery,
  MarketingImportResult,
  MarketingWebsiteDeclaration,
} from "@antelopejs/interface-dms-marketing";
import { importAnalytics } from "@/services/analytics-import";
import { ensureFunnel } from "@/services/declared-funnel";
import { ensureWebsite } from "@/services/declared-website";
import { buildTenantHeatmap } from "@/services/heatmap";
import { whenMarketingReady } from "@/services/readiness";

export async function GetClickHeatmap(
  query: MarketingHeatmapQuery,
): Promise<MarketingHeatmapPayload> {
  return buildTenantHeatmap(query);
}

// The content calls come from other modules' start, in no particular order
// with this one's: each waits for the database instead of failing on it.

export async function EnsureWebsite(
  declaration: MarketingWebsiteDeclaration,
): Promise<MarketingDeclarationResult> {
  await whenMarketingReady();
  return ensureWebsite(declaration);
}

export async function EnsureFunnel(
  declaration: MarketingFunnelDeclaration,
): Promise<MarketingDeclarationResult> {
  await whenMarketingReady();
  return ensureFunnel(declaration);
}

export async function ImportAnalytics(
  batch: MarketingAnalyticsImport,
): Promise<MarketingImportResult> {
  await whenMarketingReady();
  return importAnalytics(batch);
}
