import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { getConfig } from "@/config";
import { MarketingSessionsModel, PageSnapshotsModel } from "@/db";
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
import { websiteAcceptsHostname } from "./origin-guard";
import { findOpenSession } from "./sessionize";
import { parseTrackedUrl } from "./url";

const PAGE_PROTOCOLS = ["http:", "https:"];

/** Capture time (ms, 0 for none) per snapshot id — what the negotiation
 * reads instead of the row. Values expire with the refresh age they gate. */
const captureTimes = new BoundedCache<number>(
  SNAPSHOT_REFRESH_AGE_MS,
  SNAPSHOT_CACHE_MAX_ENTRIES,
);

/** Who a capture was handed to, and the token its upload must return. */
interface SnapshotPromise {
  token: string;
  visitorId: string;
}

/** Keys handed to a visitor whose upload may still be in flight. */
const promised = new BoundedCache<SnapshotPromise>(
  SNAPSHOT_PROMISE_TTL_MS,
  SNAPSHOT_CACHE_MAX_ENTRIES,
);

const TOKEN_BYTES = 16;

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
 * the promise TTL. Answers the token the upload must bring back, from the
 * same visitor — undefined when no capture is wanted. The promise is per
 * instance, so a second instance may hand out one more — one redundant
 * upload per instance per key at worst — and an upload landing on another
 * instance than its negotiation is refused.
 */
export async function wantsSnapshot(
  website: Website,
  url: string,
  viewportWidth: number,
  visitorId: string,
): Promise<string | undefined> {
  const id = snapshotId(website._id, layoutOfWidth(viewportWidth), url);
  const capturedAt = await captureTimeOf(website, id);
  if (Date.now() - capturedAt < SNAPSHOT_REFRESH_AGE_MS || promised.get(id)) {
    return undefined;
  }
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  promised.set(id, { token, visitorId });
  return token;
}

/**
 * Prepended to every stored document. The console renders it in a frame
 * sandboxed without scripts already; the policy holds even where that
 * sandbox would not, and covers what a sandbox leaves open (form targets,
 * plugins, nested frames). Styles, images and fonts stay unrestricted —
 * they are the page.
 */
const SNAPSHOT_CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'\">";

const DOCTYPE_PATTERN = /^\s*<!doctype[^>]*>/i;
/** Elements whose content is code, another document or a form value. */
const STRIPPED_ELEMENT_PATTERN =
  /<(script|iframe|frame|object|embed|applet|portal|noscript|template)\b[\s\S]*?<\/\1\s*>/gi;
const STRIPPED_TAG_PATTERN =
  /<\/?(script|iframe|frame|object|embed|applet|portal|base|meta)\b[^>]*>/gi;
const TEXTAREA_PATTERN = /(<textarea\b[^>]*>)[\s\S]*?(<\/textarea\s*>)/gi;
const TAG_PATTERN =
  /<([a-zA-Z][^\s/>]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const ATTRIBUTE_PATTERN =
  /\s+([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;
const SCRIPT_URL_PATTERN = /^["']?\s*javascript:/i;
const STRIPPED_ATTRIBUTES = new Set(["srcdoc", "action", "formaction"]);
const FORM_CONTROL_TAGS = new Set(["input", "textarea", "select", "option"]);
const FORM_STATE_ATTRIBUTES = new Set(["value", "checked", "selected"]);

function sanitizeTag(
  _match: string,
  tag: string,
  attributes: string,
  selfClosing: string,
): string {
  const formControl = FORM_CONTROL_TAGS.has(tag.toLowerCase());
  const kept = attributes.replace(
    ATTRIBUTE_PATTERN,
    (attribute: string, name: string, value?: string) => {
      const lower = name.toLowerCase();
      const stripped =
        lower.startsWith("on") ||
        STRIPPED_ATTRIBUTES.has(lower) ||
        (formControl && FORM_STATE_ATTRIBUTES.has(lower)) ||
        (value !== undefined && SCRIPT_URL_PATTERN.test(value));
      return stripped ? "" : attribute;
    },
  );
  return `<${tag}${kept}${selfClosing}>`;
}

/**
 * The capture script already serializes nothing executable and no form
 * value; this is the server not taking a public upload's word for it —
 * scripts, frames, plugins, handlers, script URLs and form values are
 * stripped again before storage, and the policy above goes in front.
 */
export function sanitizeSnapshotHtml(html: string): string {
  const body = html
    .replace(DOCTYPE_PATTERN, "")
    .replace(STRIPPED_ELEMENT_PATTERN, "")
    .replace(STRIPPED_TAG_PATTERN, "")
    .replace(TEXTAREA_PATTERN, "$1$2")
    .replace(TAG_PATTERN, sanitizeTag);
  // A meta ahead of <html> opens the head itself: the policy precedes
  // whatever the document puts there.
  return `<!DOCTYPE html>${SNAPSHOT_CSP_META}${body}`;
}

/** The page's origin, only on a host the website declares: it is what the
 * console's "Open" links to. */
function pageOrigin(website: Website, rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);
    return PAGE_PROTOCOLS.includes(url.protocol) &&
      websiteAcceptsHostname(website, url.hostname)
      ? url.origin
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * An upload is the end of a negotiation, never a request of its own: it
 * must bring back the token handed for this very key to this very visitor,
 * and that visitor's open session must be sitting on the page (its last
 * pageview, which the tracker flushes before negotiating). The token is spent
 * on use.
 */
async function claimPromise(
  website: Website,
  id: string,
  url: string,
  token: string,
  visitorId: string,
): Promise<boolean> {
  const promise = promised.get(id)?.value;
  if (promise?.token !== token || promise.visitorId !== visitorId) {
    return false;
  }
  const session = await findOpenSession(
    GetModel(MarketingSessionsModel, website.tenantId),
    website._id,
    visitorId,
    new Date(),
    getConfig().sessionIdleTimeout,
  );
  if (session?.exitUrl !== url) {
    return false;
  }
  promised.delete(id);
  return true;
}

/** False when the capture is refused: no matching negotiation, an origin
 * the site does not declare, or a site already holding its cap of
 * snapshots and this key being a new one. */
export async function storeSnapshot(
  website: Website,
  input: SnapshotRequestInput,
  visitorId: string,
): Promise<boolean> {
  const origin = pageOrigin(website, input.url);
  if (!origin) {
    return false;
  }
  const url = parseTrackedUrl(input.url).path;
  const layout = layoutOfWidth(input.viewport.width);
  const id = snapshotId(website._id, layout, url);
  if (!(await claimPromise(website, id, url, input.token, visitorId))) {
    return false;
  }
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
          html: gzipSync(sanitizeSnapshotHtml(input.html)).toString("base64"),
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
