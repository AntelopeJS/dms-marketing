import { currentPageUrl } from "../shared/page";
import type { SnapshotContext } from "../shared/wire";
import { DocumentSerializer } from "./serializer";
import type { SnapshotConfig } from "./settings";

const MAX_REPORTED_BYTES = 256 * 1024 * 1024;

/** The size of the whole page's content, in CSS pixels. */
interface ContentSize {
  readonly width: number;
  readonly height: number;
}

/**
 * The whole content: the document, plus what the scroll root hides, so the
 * preview unrolls it as tall as the page really is.
 */
export function contentSize(
  root: Pick<Element, "scrollWidth" | "scrollHeight">,
  scrollRoot: Pick<Element, "scrollHeight" | "clientHeight"> | null,
): ContentSize {
  const hidden = scrollRoot
    ? Math.max(scrollRoot.scrollHeight - scrollRoot.clientHeight, 0)
    : 0;
  return { width: root.scrollWidth, height: root.scrollHeight + hidden };
}

/**
 * Gzipped where the browser can (the backend recognizes the gzip header),
 * null otherwise: the upload then goes as plain JSON.
 */
async function gzip(text: string): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof CompressionStream === "undefined") {
    return null;
  }
  try {
    const stream = new Blob([text])
      .stream()
      .pipeThrough(new CompressionStream("gzip"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * text/plain is CORS-safelisted (no preflight), compressed or not; no-cors
 * keeps the unreadable answer from logging an error on the visitor's console.
 */
function post(endpoint: string, body: string | Blob): void {
  fetch(endpoint, {
    method: "POST",
    body,
    mode: "no-cors",
    credentials: "omit",
  }).catch(() => {});
}

/** The tracker's detection; a tracker older than this script has none, and the document is taken as scrolling. */
function findScrollRoot(context: SnapshotContext): Element | null {
  try {
    return context.scrollRoot ? context.scrollRoot() || null : null;
  } catch {
    return null;
  }
}

/**
 * Serializes the page and uploads it, unless it is another page than the one
 * the tracker negotiated for. The cap applies to what travels: the
 * compressed upload when there is one; a capture over it reports its size
 * alone.
 */
export async function capture(
  config: SnapshotConfig,
  context: SnapshotContext,
): Promise<void> {
  if (location.pathname !== context.path) {
    return;
  }
  const root = document.documentElement;
  const scrollRoot = findScrollRoot(context);
  const page = {
    website: context.website,
    token: config.token,
    url: currentPageUrl(),
    viewport: { width: innerWidth, height: innerHeight },
    colorScheme: matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light",
  };
  const html = new DocumentSerializer(config.maskText, scrollRoot).serialize();
  const body = JSON.stringify({
    ...page,
    document: contentSize(root, scrollRoot),
    html,
  });
  const compressed = await gzip(body);
  const size = compressed ? compressed.byteLength : new Blob([body]).size;
  if (size <= config.maxBytes) {
    post(
      context.endpoint,
      compressed ? new Blob([compressed], { type: "text/plain" }) : body,
    );
    return;
  }
  post(
    context.endpoint,
    JSON.stringify({
      ...page,
      oversizeBytes: Math.min(size, MAX_REPORTED_BYTES),
    }),
  );
}
