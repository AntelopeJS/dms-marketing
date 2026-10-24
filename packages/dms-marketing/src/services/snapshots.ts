import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { GetModel } from "@antelopejs/interface-database-decorators";
import sanitizeHtml from "sanitize-html";
import { getConfig } from "@/config";
import { MarketingSessionsModel, PageSnapshotsModel } from "@/db";
import type { PageSnapshotCapture } from "@/db/models/page_snapshots.model";
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
  MAX_STORED_SNAPSHOT_CHARS,
  SNAPSHOT_CACHE_MAX_ENTRIES,
  SNAPSHOT_CAPTURE_CACHE_TTL_MS,
  SNAPSHOT_PROMISE_TTL_MS,
  SNAPSHOT_REFRESH_AGE_MS,
} from "@/types/constants";
import { BoundedCache } from "./bounded-cache";
import { websiteAcceptsHostname } from "./origin-guard";
import { noteCollected } from "./realtime";
import { findOpenSession } from "./sessionize";
import { parseTrackedUrl } from "./url";

const PAGE_PROTOCOLS = ["http:", "https:"];

/** Marks the container a capture unrolled (static/snapshot.js). */
const SCROLL_ROOT_ATTRIBUTE = "data-marketing-scroll-root";

/** What the negotiation knows of one key's row. */
interface CaptureState {
  /** Capture time in ms, 0 for no row. */
  capturedAt: number;
  /** A capture stored before captures recorded their scroll root mark. */
  unmarked: boolean;
}

const NO_CAPTURE: CaptureState = { capturedAt: 0, unmarked: false };

/**
 * Per snapshot id, what the negotiation reads instead of the row. Kept
 * minutes, not the refresh age it gates: a row deleted where this instance
 * cannot see it — another instance, a prune, a manual cleanup — must not
 * hold a page without a snapshot off for a day.
 */
const captureStates = new BoundedCache<CaptureState>(
  SNAPSHOT_CAPTURE_CACHE_TTL_MS,
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

export function snapshotId(
  websiteId: string,
  layout: SnapshotLayout,
  url: string,
): string {
  return createHash("sha256")
    .update(`${websiteId}\n${layout}\n${url}`)
    .digest("hex");
}

async function captureStateOf(
  website: Website,
  id: string,
): Promise<CaptureState> {
  const cached = captureStates.get(id);
  if (cached) {
    return cached.value;
  }
  const row = await GetModel(PageSnapshotsModel, website.tenantId).get(id);
  const state = row
    ? {
        capturedAt: row.capturedAt.getTime(),
        unmarked: row.scrollRoot === undefined,
      }
    : NO_CAPTURE;
  captureStates.set(id, state);
  return state;
}

/** Whether a serialized page marks the inner container it scrolls. */
export function hasScrollRoot(html: string): boolean {
  return html.includes(SCROLL_ROOT_ATTRIBUTE);
}

/** What the negotiation reads for a snapshot written outside a capture. */
export function rememberCaptureTime(id: string, capturedAt: number): void {
  captureStates.set(id, { capturedAt, unmarked: false });
}

/** Every remembered capture forgotten: rows went in bulk (the retention
 * prune), so the next negotiation of each key reads its row again. */
export function forgetCaptureTimes(): void {
  captureStates.clear();
}

/**
 * Whether a sampled visit should capture (website, path, layout) now: no
 * capture within the refresh age, none promised to another visitor within
 * the promise TTL. Answers the token the upload must bring back, from the
 * same visitor — undefined when no capture is wanted. The promise is per
 * instance, so a second instance may hand out one more — one redundant
 * upload per instance per key at worst — and an upload landing on another
 * instance than its negotiation is refused.
 *
 * `scrollRoot` is the tracker saying the page scrolls an inner container: a
 * capture stored before captures recorded that mark is stale then, and is
 * replaced at once rather than a refresh age later. A capture that recorded
 * it — found or not — never is, so a page the two scripts disagree on is
 * not captured again on every visit.
 */
export async function wantsSnapshot(
  website: Website,
  url: string,
  viewportWidth: number,
  visitorId: string,
  scrollRoot = false,
): Promise<string | undefined> {
  const id = snapshotId(website._id, layoutOfWidth(viewportWidth), url);
  const state = await captureStateOf(website, id);
  const fresh =
    Date.now() - state.capturedAt < SNAPSHOT_REFRESH_AGE_MS &&
    !(scrollRoot && state.unmarked);
  if (fresh || promised.get(id)) {
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
 * they are the page. These two remain the primary defence: the sanitizer
 * below is a second layer, not what the console relies on.
 */
const SNAPSHOT_CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'\">";

/** Elements dropped with their content: code, another document, a form
 * target base, a refresh. Shadow roots (`template`) included, as before. */
const DROPPED_TAGS = new Set([
  "script",
  "iframe",
  "frame",
  "object",
  "embed",
  "applet",
  "portal",
  "noscript",
  "template",
  "base",
  "meta",
]);
const STRIPPED_ATTRIBUTES = new Set(["srcdoc", "action", "formaction"]);
const FORM_CONTROL_TAGS = new Set(["input", "textarea", "select", "option"]);
const FORM_STATE_ATTRIBUTES = new Set(["value", "checked", "selected"]);
/** Void elements, serialized `<tag />` with no end tag (a stray `</br>`
 * would render as one more break). */
const VOID_TAGS = [
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
];
/** Every other scheme — `javascript:` and `vbscript:` first, however
 * entity-encoded or padded — drops the URL attribute carrying it. */
const URL_SCHEMES = [
  "http",
  "https",
  "data",
  "blob",
  "mailto",
  "tel",
  "sms",
  "ftp",
];

function withoutUnsafeAttributes(
  tagName: string,
  attribs: sanitizeHtml.Attributes,
): sanitizeHtml.Tag {
  const formControl = FORM_CONTROL_TAGS.has(tagName);
  const kept: sanitizeHtml.Attributes = {};
  for (const [name, value] of Object.entries(attribs)) {
    if (
      !name.startsWith("on") &&
      !STRIPPED_ATTRIBUTES.has(name) &&
      !(formControl && FORM_STATE_ATTRIBUTES.has(name))
    ) {
      kept[name] = value;
    }
  }
  return { tagName, attribs: kept };
}

/**
 * Every tag and attribute of the page is kept — custom elements, classes,
 * inline styles, `hidden`, data-* — except what the denylists above name;
 * URL attributes (href, src, srcset, xlink:href…) are scheme-checked after
 * entity decoding. A `<style>` is re-emitted verbatim, so one holding a `<`
 * that could open markup — followed by a letter, `!`, `/` or `?`: a tag, a
 * comment or `</style` itself, which inside `<svg>` or `<math>` the browser
 * parses as markup — is dropped rather than risk a parser disagreement. A
 * `<` before anything else is text everywhere and stays: Tailwind's
 * `@media (width < 48rem)`. The capture escapes the character after a `<`
 * in the CSS it serializes, so no sheet of a real page is dropped.
 */
const MARKUP_OPENING = /<[a-z!/?]/i;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: false,
  allowedAttributes: false,
  allowVulnerableTags: true,
  allowedSchemes: URL_SCHEMES,
  nonBooleanAttributes: [],
  parseStyleAttributes: false,
  selfClosing: VOID_TAGS,
  exclusiveFilter: (frame) =>
    DROPPED_TAGS.has(frame.tag) ||
    (frame.tag === "style" && MARKUP_OPENING.test(frame.text)),
  transformTags: {
    textarea: (tagName, attribs) => ({ tagName, attribs, text: "" }),
    "*": withoutUnsafeAttributes,
  },
};

/**
 * The capture script already serializes nothing executable and no form
 * value; this is the server not taking a public upload's word for it —
 * the upload goes through a real HTML parser, scripts, frames, plugins,
 * handlers, script URLs and form values are stripped again before
 * storage, and the policy above goes in front.
 */
export function sanitizeSnapshotHtml(html: string): string {
  // The parser drops the doctype and comments; a meta ahead of <html> opens
  // the head itself, so the policy precedes whatever the document puts there.
  return `<!DOCTYPE html>${SNAPSHOT_CSP_META}${sanitizeHtml(html, SANITIZE_OPTIONS)}`;
}

/** Attributes that carry text a visitor could read: the ones
 * static/snapshot.js masks with the text. */
const TEXT_ATTRIBUTES = new Set([
  "title",
  "alt",
  "label",
  "placeholder",
  "aria-label",
  "aria-description",
  "aria-placeholder",
  "aria-valuetext",
]);
const MASK_CHAR = "x";
const CHARACTER_REFERENCE = /&(?:[a-z\d]+|#\d+|#x[\da-f]+);/gi;

/** As the capture masks: every visible character, whitespace kept so
 * lines still wrap where they did. The parser hands text re-escaped, so a
 * character reference is one character. */
function maskText(text: string): string {
  return text.replace(CHARACTER_REFERENCE, MASK_CHAR).replace(/\S/g, MASK_CHAR);
}

function withMaskedAttributes(
  tagName: string,
  attribs: sanitizeHtml.Attributes,
): sanitizeHtml.Tag {
  const tag = withoutUnsafeAttributes(tagName, attribs);
  for (const name of Object.keys(tag.attribs)) {
    if (TEXT_ATTRIBUTES.has(name)) {
      tag.attribs[name] = maskText(tag.attribs[name] ?? "");
    }
  }
  return tag;
}

/** The sanitizer's pass, text masked: `<style>` stays verbatim (the parser
 * hands it to no text filter), so the page keeps its look. */
const MASK_OPTIONS: sanitizeHtml.IOptions = {
  ...SANITIZE_OPTIONS,
  textFilter: maskText,
  transformTags: {
    ...SANITIZE_OPTIONS.transformTags,
    "*": withMaskedAttributes,
  },
};

/**
 * A stored document with its text masked, whatever its site's own mask
 * setting: the structure, blocks and styles stay, every word, label and
 * alternative text becomes `x`. What a backdrop read outside the viewer's
 * workspace sends — another workspace's unmasked capture never leaves the
 * server. Sanitized again on the way, the policy back in front.
 */
export function maskSnapshotHtml(html: string): string {
  return `<!DOCTYPE html>${SNAPSHOT_CSP_META}${sanitizeHtml(html, MASK_OPTIONS)}`;
}

/** The page's origin, only on a host the website declares: it is what the
 * console's "Open" links to. */
export function pageOrigin(
  website: Website,
  rawUrl: string,
): string | undefined {
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

/**
 * The row's document: gzipped and base64 (the size a row reaches is about
 * 4/3 of the compressed upload), or an oversize report — the upload's own,
 * or a document that would not fit a row once stored (`bytes` is then the
 * serialized size).
 */
export function storedDocument(input: SnapshotRequestInput): {
  document: { width: number; height: number };
  bytes: number;
  html: string;
} {
  if ("html" in input) {
    const html = gzipSync(sanitizeSnapshotHtml(input.html)).toString("base64");
    const bytes = Buffer.byteLength(input.html);
    if (html.length <= MAX_STORED_SNAPSHOT_CHARS) {
      return { document: input.document, bytes, html };
    }
    return { document: { width: 0, height: 0 }, bytes, html: "" };
  }
  return {
    document: { width: 0, height: 0 },
    bytes: input.oversizeBytes,
    html: "",
  };
}

/** False when the capture is refused: no matching negotiation, an origin
 * the site does not declare, or a site already holding its cap of
 * snapshots and this key being a new one. A refusal stamps no capture
 * time: the key stays wanted, held off at most by its promise's TTL. */
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
  const replacing = (await captureStateOf(website, id)).capturedAt > 0;
  if (
    !replacing &&
    (await model.countByWebsite(website._id)) >= MAX_SNAPSHOTS_PER_WEBSITE
  ) {
    return false;
  }
  const stored = storedDocument(input);
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
    scrollRoot: "html" in input && hasScrollRoot(input.html),
  } as PageSnapshot);
  captureStates.set(id, { capturedAt: now.getTime(), unmarked: false });
  noteCollected(website.tenantId, 1);
  return true;
}

/** What the pages list says of one path's captures. */
export interface PageSnapshotSummary {
  /** The newest capture with a document, else the newest oversize report. */
  capturedAt: number;
  /** Layouts holding a document, widest first. */
  layouts: SnapshotLayout[];
  /** Only oversize reports: the page is too heavy to capture. */
  tooHeavy: boolean;
}

/**
 * The captures of a whole site, summarized per path, from one read that
 * leaves the documents in the database.
 */
export async function summarizeSnapshots(
  tenantId: string,
  websiteId: string,
): Promise<Map<string, PageSnapshotSummary>> {
  const rows = await GetModel(PageSnapshotsModel, tenantId).listCaptures(
    websiteId,
  );
  const byPath = new Map<string, PageSnapshotCapture[]>();
  for (const row of rows) {
    byPath.set(row.url, [...(byPath.get(row.url) ?? []), row]);
  }
  const summaries = new Map<string, PageSnapshotSummary>();
  for (const [url, captures] of byPath) {
    const rendered = captures.filter((row) => row.documentWidth > 0);
    const shown = rendered.length > 0 ? rendered : captures;
    summaries.set(url, {
      capturedAt: Math.max(
        ...shown.map((row) => new Date(row.capturedAt).getTime()),
      ),
      layouts: SNAPSHOT_LAYOUTS.filter((layout) =>
        rendered.some((row) => row.layout === layout),
      ),
      tooHeavy: rendered.length === 0,
    });
  }
  return summaries;
}

/**
 * The captures of several sites, summarized per path as one: the layouts
 * any holds, too heavy only where every site's captures of it are.
 */
export async function summarizeScopedSnapshots(
  sites: Array<{ tenantId: string; websiteId: string }>,
): Promise<Map<string, PageSnapshotSummary>> {
  const merged = new Map<string, PageSnapshotSummary>();
  const all = await Promise.all(
    sites.map((site) => summarizeSnapshots(site.tenantId, site.websiteId)),
  );
  for (const summaries of all) {
    for (const [url, summary] of summaries) {
      const seen = merged.get(url);
      merged.set(
        url,
        seen
          ? {
              // A document beats an oversize report, as within one site.
              capturedAt:
                seen.tooHeavy === summary.tooHeavy
                  ? Math.max(seen.capturedAt, summary.capturedAt)
                  : (seen.tooHeavy ? summary : seen).capturedAt,
              layouts: SNAPSHOT_LAYOUTS.filter(
                (layout) =>
                  seen.layouts.includes(layout) ||
                  summary.layouts.includes(layout),
              ),
              tooHeavy: seen.tooHeavy && summary.tooHeavy,
            }
          : summary,
      );
    }
  }
  return merged;
}

export interface PageSnapshotPayload {
  layout: SnapshotLayout;
  /** False when no capture exists at the asked layout and the nearest one
   * stands in, reflowed at the asked width. */
  exact: boolean;
  capturedAt: number;
  origin: string;
  /** The page captured, origin and path: query string and fragment are
   * never kept (see storeSnapshot), so this is all of it there is. */
  url: string;
  viewport: { width: number; height: number };
  document: { width: number; height: number };
  colorScheme?: SnapshotColorScheme;
  bytes: number;
  /** The upload cap in force (`snapshotMaxBytes`), for an oversize notice. */
  maxBytes: number;
  html: string | null;
  /** Text masked by the server on the way out (see maskSnapshotHtml). */
  masked?: boolean;
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
    url: `${row.origin}${row.url}`,
    viewport: { width: row.viewportWidth, height: row.viewportHeight },
    document: { width: row.documentWidth, height: row.documentHeight },
    colorScheme: row.colorScheme,
    bytes: row.bytes,
    maxBytes: getConfig().snapshotMaxBytes,
    html: row.html
      ? gunzipSync(Buffer.from(row.html, "base64")).toString("utf8")
      : null,
  };
}

/** A document first, then the asked layout, then the newest. */
function bestAcrossSites(a: PageSnapshotPayload, b: PageSnapshotPayload) {
  return (
    Number(b.html !== null) - Number(a.html !== null) ||
    Number(b.exact) - Number(a.exact) ||
    b.capturedAt - a.capturedAt
  );
}

/**
 * Backdrop of one path over several sites, each read in its own tenant: the
 * best capture of each, then the one that renders, at the asked layout, the
 * most recent — the page as it looks now. With `mask`, its text is masked
 * here, before anything is sent.
 */
export async function readScopedPageSnapshot(
  sites: Array<{ tenantId: string; websiteId: string }>,
  url: string,
  layout: SnapshotLayout,
  mask: boolean,
): Promise<PageSnapshotPayload | null> {
  const found = await Promise.all(
    sites.map((site) =>
      readPageSnapshot(site.tenantId, site.websiteId, url, layout),
    ),
  );
  const best = found
    .filter((snapshot) => snapshot !== null)
    .sort(bestAcrossSites)[0];
  if (!best || !mask) {
    return best ?? null;
  }
  return {
    ...best,
    html: best.html === null ? null : maskSnapshotHtml(best.html),
    masked: true,
  };
}

/**
 * One path when given, the whole site otherwise. This instance's
 * negotiation cache forgets the keys too, so its next sampled visit
 * recaptures at once; another instance notices within its cache TTL
 * (SNAPSHOT_CAPTURE_CACHE_TTL_MS).
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
      captureStates.delete(snapshotId(websiteId, layout, url));
    }
  } else {
    captureStates.clear();
  }
  return deleted;
}
