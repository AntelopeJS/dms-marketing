import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { PageSnapshotsModel } from "@/db";
import type { PageSnapshot } from "@/db/tables/page_snapshots.table";
import type { Website } from "@/db/tables/websites.table";
import {
  layoutOfWidth,
  SNAPSHOT_LAYOUTS,
  type SnapshotColorScheme,
  type SnapshotLayout,
  type SnapshotRequestInput,
} from "@/types";
import {
  MAX_SNAPSHOTS_PER_WEBSITE,
  SNAPSHOT_CACHE_MAX_ENTRIES,
  SNAPSHOT_PROMISE_TTL_MS,
  SNAPSHOT_REFRESH_AGE_MS,
} from "@/types/constants";
import { BoundedCache } from "./bounded-cache";
import { parseTrackedUrl } from "./url";

const PAGE_PROTOCOLS = ["http:", "https:"];

/** Capture time (ms, 0 for none) per snapshot id — what the negotiation
 * reads instead of the row. Values expire with the refresh age they gate. */
const captureTimes = new BoundedCache<number>(
  SNAPSHOT_REFRESH_AGE_MS,
  SNAPSHOT_CACHE_MAX_ENTRIES,
);

/** Keys handed to a visitor whose upload may still be in flight. */
const promised = new BoundedCache<true>(
  SNAPSHOT_PROMISE_TTL_MS,
  SNAPSHOT_CACHE_MAX_ENTRIES,
);

function snapshotId(
  websiteId: string,
  layout: SnapshotLayout,
  url: string,
): string {
  return createHash("sha256")
    .update(`${websiteId}\n${layout}\n${url}`)
    .digest("hex");
}

async function captureTimeOf(website: Website, id: string): Promise<number> {
  const cached = captureTimes.get(id);
  if (cached) {
    return cached.value;
  }
  const row = await GetModel(PageSnapshotsModel, website.tenantId).get(id);
  const time = row?.capturedAt.getTime() ?? 0;
  captureTimes.set(id, time);
  return time;
}

/**
 * Whether a sampled visit should capture (website, path, layout) now: no
 * capture within the refresh age, none promised to another visitor within
 * the promise TTL. The promise is per instance, so a second instance may
 * hand out one more — one redundant upload per instance per key at worst.
 */
export async function wantsSnapshot(
  website: Website,
  url: string,
  viewportWidth: number,
): Promise<boolean> {
  const id = snapshotId(website._id, layoutOfWidth(viewportWidth), url);
  const capturedAt = await captureTimeOf(website, id);
  if (Date.now() - capturedAt < SNAPSHOT_REFRESH_AGE_MS || promised.get(id)) {
    return false;
  }
  promised.set(id, true);
  return true;
}

function pageOrigin(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    return PAGE_PROTOCOLS.includes(url.protocol) ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/** False when the capture is refused: unusable origin, or a site already
 * holding its cap of snapshots and this key being a new one. */
export async function storeSnapshot(
  website: Website,
  input: SnapshotRequestInput,
): Promise<boolean> {
  const origin = pageOrigin(input.url);
  if (!origin) {
    return false;
  }
  const url = parseTrackedUrl(input.url).path;
  const layout = layoutOfWidth(input.viewport.width);
  const id = snapshotId(website._id, layout, url);
  const model = GetModel(PageSnapshotsModel, website.tenantId);
  const replacing = (await captureTimeOf(website, id)) > 0;
  if (
    !replacing &&
    (await model.countByWebsite(website._id)) >= MAX_SNAPSHOTS_PER_WEBSITE
  ) {
    return false;
  }
  const stored =
    "html" in input
      ? {
          document: input.document,
          bytes: Buffer.byteLength(input.html),
          html: gzipSync(input.html).toString("base64"),
        }
      : {
          document: { width: 0, height: 0 },
          bytes: input.oversizeBytes,
          html: "",
        };
  const now = new Date();
  await model.upsert({
    _id: id,
    websiteId: website._id,
    url,
    layout,
    origin,
    viewportWidth: input.viewport.width,
    viewportHeight: input.viewport.height,
    documentWidth: stored.document.width,
    documentHeight: stored.document.height,
    colorScheme: input.colorScheme,
    capturedAt: now,
    bytes: stored.bytes,
    html: stored.html,
  } as PageSnapshot);
  captureTimes.set(id, now.getTime());
  return true;
}

export interface PageSnapshotPayload {
  layout: SnapshotLayout;
  /** False when no capture exists at the asked layout and the nearest one
   * stands in, reflowed at the asked width. */
  exact: boolean;
  capturedAt: number;
  origin: string;
  viewport: { width: number; height: number };
  document: { width: number; height: number };
  colorScheme?: SnapshotColorScheme;
  bytes: number;
  html: string | null;
}

function layoutRank(layout: SnapshotLayout): number {
  return SNAPSHOT_LAYOUTS.indexOf(layout);
}

/** Nearest first; on a tie the wider layout, which reflows down better. */
function bestFor(wanted: SnapshotLayout) {
  return (a: PageSnapshot, b: PageSnapshot): number => {
    const backdrop = Number(a.html === "") - Number(b.html === "");
    const distance =
      Math.abs(layoutRank(a.layout) - layoutRank(wanted)) -
      Math.abs(layoutRank(b.layout) - layoutRank(wanted));
    return backdrop || distance || layoutRank(a.layout) - layoutRank(b.layout);
  };
}

export async function readPageSnapshot(
  tenantId: string,
  websiteId: string,
  url: string,
  layout: SnapshotLayout,
): Promise<PageSnapshotPayload | null> {
  const rows = await GetModel(PageSnapshotsModel, tenantId).getByPath(
    websiteId,
    url,
  );
  const row = rows.sort(bestFor(layout))[0];
  if (!row) {
    return null;
  }
  return {
    layout: row.layout,
    exact: row.layout === layout,
    capturedAt: row.capturedAt.getTime(),
    origin: row.origin,
    viewport: { width: row.viewportWidth, height: row.viewportHeight },
    document: { width: row.documentWidth, height: row.documentHeight },
    colorScheme: row.colorScheme,
    bytes: row.bytes,
    html: row.html
      ? gunzipSync(Buffer.from(row.html, "base64")).toString("utf8")
      : null,
  };
}

/**
 * One path when given, the whole site otherwise. The negotiation cache
 * forgets the keys too, so the next sampled visit recaptures at once.
 */
export async function deleteSnapshots(
  tenantId: string,
  websiteId: string,
  url?: string,
): Promise<number> {
  const deleted = await GetModel(PageSnapshotsModel, tenantId).deleteByWebsite(
    websiteId,
    url,
  );
  if (url) {
    for (const layout of SNAPSHOT_LAYOUTS) {
      captureTimes.delete(snapshotId(websiteId, layout, url));
    }
  } else {
    captureTimes.clear();
  }
  return deleted;
}
