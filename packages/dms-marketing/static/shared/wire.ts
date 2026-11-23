/**
 * What the tracker leaves in `window.__dmsMarketingSnapshotContext` for the
 * capture script. The capture script reads whatever is there: a tracker older
 * than the script (tracker.js is cached for an hour) publishes less, so only
 * `endpoint` is required.
 */
export interface SnapshotContext {
  readonly website?: string;
  readonly endpoint: string;
  readonly path?: string;
  /** The tracker's detection of the page's inner scroll container, run at capture time. */
  readonly scrollRoot?: () => Element | null;
}

declare global {
  interface Window {
    /** Module settings the tracker route prepends to tracker.js; read once and removed. */
    __dmsMarketingTrackerConfig?: unknown;
    /** Settings the snapshot route prepends to snapshot.js; read once and removed. */
    __dmsMarketingSnapshotConfig?: unknown;
    /** Left by the tracker for the capture script, which reads it once and removes it. */
    __dmsMarketingSnapshotContext?: unknown;
    /** Published by experiments.js; read once and removed. */
    __dmsMarketingAssignments?: unknown;
  }
}
