import { parseExcludedPaths } from "./excluded-paths";
import { type ServedConfig, resolveSampleRate } from "./settings";

/** The attribute of the tag that names the website events are collected for. */
const WEBSITE_ATTRIBUTE = "data-website-id";

/** Everything one page load of the tracker reads off its own tag, and the two facts that change as the page lives. */
export interface TrackerSession {
  readonly script: HTMLScriptElement;
  readonly hostUrl: string;
  readonly sampleRate: number;
  readonly heatmapSampled: boolean;
  /** Patterns of `data-exclude-paths`, each a path starting with "/". */
  readonly excludedPaths: readonly string[];
  /** Null while the page removed the tag's attribute: nothing is collected meanwhile. */
  websiteId: string | null;
  /** The page on screen matches `data-exclude-paths`: nothing it does is sent, its clicks and scroll depth included. */
  pageExcluded: boolean;
}

/**
 * Whether `element` is the tracker's own `<script>` tag. An SVG `<script>`
 * has no `src`, so the collect origin could not be derived from it.
 */
export function isTagElement(
  element: HTMLOrSVGScriptElement | null,
): element is HTMLScriptElement {
  return (
    element !== null && "src" in element && typeof element.src === "string"
  );
}

/** Reads the tag once, when the tracker starts collecting. */
export function openSession(
  script: HTMLScriptElement,
  served: ServedConfig,
): TrackerSession {
  const sampleRate = resolveSampleRate(
    script.getAttribute("data-heatmap-sample"),
    served,
  );
  return {
    script,
    hostUrl: script.getAttribute("data-host-url") || new URL(script.src).origin,
    sampleRate,
    heatmapSampled: Math.random() < sampleRate,
    excludedPaths: parseExcludedPaths(
      script.getAttribute("data-exclude-paths"),
    ),
    websiteId: script.getAttribute(WEBSITE_ATTRIBUTE),
    pageExcluded: false,
  };
}

/** The website the tag names now, or null once the page removed the attribute. */
export function tagWebsiteId(session: TrackerSession): string | null {
  return session.script.getAttribute(WEBSITE_ATTRIBUTE) || null;
}

/** Whether the tag still names `website`: attribute writes are synchronous while the observer that retargets the session is not. */
export function tagNamesWebsite(
  session: TrackerSession,
  website: string,
): boolean {
  return session.script.getAttribute(WEBSITE_ATTRIBUTE) === website;
}

/** The session has a website and the tag still names it. */
export function isAimed(session: TrackerSession): boolean {
  const website = session.websiteId;
  return !!website && tagNamesWebsite(session, website);
}
