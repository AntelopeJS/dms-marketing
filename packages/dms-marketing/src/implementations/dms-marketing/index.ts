import type {
  MarketingAnalyticsImport,
  MarketingDeclarationResult,
  MarketingFunnelDeclaration,
  MarketingHeatmapPayload,
  MarketingHeatmapQuery,
  MarketingImportResult,
  MarketingPageSnapshotDeclaration,
  MarketingPageSnapshotResult,
  MarketingWebsiteDeclaration,
} from "@antelopejs/interface-dms-marketing";
import { importAnalytics } from "@/services/analytics-import";
import { ensureFunnel } from "@/services/declared-funnel";
import { ensurePageSnapshot } from "@/services/declared-snapshot";
import { ensureWebsite } from "@/services/declared-website";
import { buildTenantHeatmap } from "@/services/heatmap";

export async function GetClickHeatmap(
  query: MarketingHeatmapQuery,
): Promise<MarketingHeatmapPayload> {
  return buildTenantHeatmap(query);
}

export async function EnsureWebsite(
  declaration: MarketingWebsiteDeclaration,
): Promise<MarketingDeclarationResult> {
  return ensureWebsite(declaration);
}

export async function EnsureFunnel(
  declaration: MarketingFunnelDeclaration,
): Promise<MarketingDeclarationResult> {
  return ensureFunnel(declaration);
}

export async function EnsurePageSnapshot(
  declaration: MarketingPageSnapshotDeclaration,
): Promise<MarketingPageSnapshotResult> {
  return ensurePageSnapshot(declaration);
}

export async function ImportAnalytics(
  batch: MarketingAnalyticsImport,
): Promise<MarketingImportResult> {
  return importAnalytics(batch);
}
