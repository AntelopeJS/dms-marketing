import { gzipSync } from "node:zlib";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type {
  MarketingDeclarationStatus,
  MarketingPageSnapshotDeclaration,
  MarketingPageSnapshotResult,
} from "@antelopejs/interface-dms-marketing";
import { PageSnapshotsModel, WebsitesModel } from "@/db";
import type { PageSnapshot } from "@/db/tables/page_snapshots.table";
import type { Website } from "@/db/tables/websites.table";
import { layoutOfWidth, snapshotDeclarationSchema } from "@/types";
import { MAX_SNAPSHOTS_PER_WEBSITE } from "@/types/constants";
import {
  declaredTenant,
  describeIssue,
  MarketingDeclarationError,
} from "./declarations";
import {
  hasScrollRoot,
  pageOrigin,
  rememberCaptureTime,
  sanitizeSnapshotHtml,
  snapshotId,
} from "./snapshots";
import { parseTrackedUrl } from "./url";

const OPERATION = "EnsurePageSnapshot";

function refuse(url: string, reason: string): MarketingDeclarationError {
  return new MarketingDeclarationError(OPERATION, url, reason);
}

async function requireWebsite(
  url: string,
  websiteId: string,
  tenantId: string,
): Promise<Website> {
  const website = await GetModel(WebsitesModel).get(websiteId);
  if (!website || website.tenantId !== tenantId) {
    throw refuse(url, `no website "${websiteId}" in the tenant "${tenantId}"`);
  }
  if (!website.snapshotsEnabled) {
    throw refuse(
      url,
      `page snapshots are off for the website "${websiteId}": declare it with snapshotsEnabled`,
    );
  }
  return website;
}

async function writeSnapshot(
  tenantId: string,
  website: Website,
  row: PageSnapshot,
): Promise<MarketingDeclarationStatus> {
  const model = GetModel(PageSnapshotsModel, tenantId);
  if (await model.get(row._id)) {
    return "kept";
  }
  if ((await model.countByWebsite(website._id)) >= MAX_SNAPSHOTS_PER_WEBSITE) {
    throw refuse(
      row.url,
      `the website "${website._id}" already holds its ${MAX_SNAPSHOTS_PER_WEBSITE} snapshots`,
    );
  }
  try {
    await model.insert(row);
  } catch (err) {
    if (!(await model.get(row._id))) {
      throw err;
    }
    return "kept";
  }
  return "created";
}

/**
 * EnsurePageSnapshot: stored under the key a capture of the same page at the
 * same layout would take, so a capture replaces it. Written once: a snapshot
 * already stored under that key, captured or declared, is `kept`.
 */
export async function ensurePageSnapshot(
  declaration: MarketingPageSnapshotDeclaration,
): Promise<MarketingPageSnapshotResult> {
  const label = String(declaration?.url);
  const tenantId = declaredTenant(OPERATION, label, declaration?.tenantId);
  const parsed = snapshotDeclarationSchema.safeParse(declaration);
  if (!parsed.success) {
    throw refuse(label, describeIssue(parsed.error));
  }
  const input = parsed.data;
  const website = await requireWebsite(label, input.websiteId, tenantId);
  const origin = pageOrigin(website, input.url);
  if (!origin) {
    throw refuse(
      label,
      `not an http(s) page on a host the website "${website._id}" accepts`,
    );
  }
  const url = parseTrackedUrl(input.url).path;
  const layout = layoutOfWidth(input.viewport.width);
  const html = sanitizeSnapshotHtml(input.html);
  const now = new Date();
  const row = {
    _id: snapshotId(website._id, layout, url),
    websiteId: website._id,
    url,
    layout,
    origin,
    viewportWidth: input.viewport.width,
    viewportHeight: input.viewport.height,
    documentWidth: input.document.width,
    documentHeight: input.document.height,
    colorScheme: input.colorScheme,
    capturedAt: now,
    bytes: Buffer.byteLength(input.html),
    scrollRoot: hasScrollRoot(html),
    html: gzipSync(html).toString("base64"),
  } as PageSnapshot;
  const status = await writeSnapshot(tenantId, website, row);
  if (status === "created") {
    rememberCaptureTime(row._id, now.getTime());
  }
  return { url, layout, status };
}
