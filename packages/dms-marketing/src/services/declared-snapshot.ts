import { gunzipSync, gzipSync } from "node:zlib";
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
  contentHash,
  declaredTenant,
  describeIssue,
  isUntouchedSinceDeclared,
  MarketingDeclarationError,
} from "./declarations";
import {
  pageOrigin,
  rememberCaptureTime,
  sanitizeSnapshotHtml,
  snapshotId,
} from "./snapshots";
import { parseTrackedUrl } from "./url";

const OPERATION = "EnsurePageSnapshot";

/** What a declaration stores, normalized: also what its hash covers. */
interface SnapshotContent {
  origin: string;
  viewport: { width: number; height: number };
  document: { width: number; height: number };
  colorScheme: string | null;
  /** Sanitized, as stored once unzipped. */
  html: string;
}

/** The same fields read off a stored row, in the same order. */
function storedContent(row: PageSnapshot): SnapshotContent {
  return {
    origin: row.origin,
    viewport: { width: row.viewportWidth, height: row.viewportHeight },
    document: { width: row.documentWidth, height: row.documentHeight },
    colorScheme: row.colorScheme ?? null,
    html: row.html
      ? gunzipSync(Buffer.from(row.html, "base64")).toString("utf8")
      : "",
  };
}

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

/**
 * Brings an existing snapshot to the declaration when it is still the one
 * last declared; a capture (no declared hash) or anything else is kept.
 */
async function refreshSnapshot(
  model: PageSnapshotsModel,
  existing: PageSnapshot,
  row: PageSnapshot,
): Promise<MarketingDeclarationStatus> {
  if (
    !isUntouchedSinceDeclared(existing.declaredHash, storedContent(existing))
  ) {
    return "kept";
  }
  if (row.declaredHash === existing.declaredHash) {
    return "unchanged";
  }
  const { _id: _unchangedId, ...patch } = row;
  return (await model.replaceIfUnchanged(existing, patch)) ? "updated" : "kept";
}

async function writeSnapshot(
  tenantId: string,
  website: Website,
  row: PageSnapshot,
): Promise<MarketingDeclarationStatus> {
  const model = GetModel(PageSnapshotsModel, tenantId);
  const existing = await model.get(row._id);
  if (existing) {
    return refreshSnapshot(model, existing, row);
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
    // A capture or another instance booting the same project got there first.
    const raced = await model.get(row._id);
    if (!raced) {
      throw err;
    }
    return refreshSnapshot(model, raced, row);
  }
  return "created";
}

/**
 * EnsurePageSnapshot: stored under the key a capture of the same page at the
 * same layout would take, so a capture replaces it — and is never replaced.
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
  const content: SnapshotContent = {
    origin,
    viewport: input.viewport,
    document: input.document,
    colorScheme: input.colorScheme ?? null,
    html: sanitizeSnapshotHtml(input.html),
  };
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
    html: gzipSync(content.html).toString("base64"),
    declaredHash: contentHash(content),
  } as PageSnapshot;
  const status = await writeSnapshot(tenantId, website, row);
  if (status === "created" || status === "updated") {
    rememberCaptureTime(row._id, now.getTime());
  }
  return { url, layout, status };
}
