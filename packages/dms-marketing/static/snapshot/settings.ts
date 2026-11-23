import { isFiniteNumber, isRecord, isString } from "../shared/guards";
import type { SnapshotContext } from "../shared/wire";

/** The settings the snapshot route prepends to snapshot.js. */
export interface SnapshotConfig {
  /** The website masks every text node and text attribute of the page. */
  readonly maskText: boolean;
  /** One-time token the upload is accepted under. */
  readonly token: string;
  /** Cap on what travels; NaN when the route sent none, which no upload meets. */
  readonly maxBytes: number;
}

function isScrollRootFinder(value: unknown): value is () => Element | null {
  return typeof value === "function";
}

/** Read once and removed; null when the route injected nothing usable. */
export function readSnapshotConfig(): SnapshotConfig | null {
  const published = window.__dmsMarketingSnapshotConfig;
  delete window.__dmsMarketingSnapshotConfig;
  if (!isRecord(published) || !isString(published.token)) {
    return null;
  }
  return {
    maskText: published.maskText === true,
    token: published.token,
    maxBytes: isFiniteNumber(published.maxBytes)
      ? published.maxBytes
      : Number.NaN,
  };
}

/** Read once and removed; null when the tracker left nothing usable. */
export function readSnapshotContext(): SnapshotContext | null {
  const published = window.__dmsMarketingSnapshotContext;
  delete window.__dmsMarketingSnapshotContext;
  if (!isRecord(published) || !isString(published.endpoint)) {
    return null;
  }
  return {
    website: isString(published.website) ? published.website : undefined,
    endpoint: published.endpoint,
    path: isString(published.path) ? published.path : undefined,
    scrollRoot: isScrollRootFinder(published.scrollRoot)
      ? published.scrollRoot
      : undefined,
  };
}
