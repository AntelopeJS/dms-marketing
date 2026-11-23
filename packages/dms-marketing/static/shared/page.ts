/** Mirrors the backend MAX_URL_LENGTH: cut here, nothing is lost to validation. */
export const MAX_URL_LENGTH = 500;

/** Names the element that scrolls the page, where the document does not. */
export const SCROLL_ROOT_ATTRIBUTE = "data-marketing-scroll-root";

/**
 * The page's URL with its query, cut to the backend cap. Absolute: the
 * backend stores the path only, but needs the hostname to tell an internal
 * navigation from an acquisition referrer.
 */
export function currentPageUrl(): string {
  return (location.origin + location.pathname + location.search).slice(
    0,
    MAX_URL_LENGTH,
  );
}

/** Runs `callback` in idle time, or on the next tick in a browser without `requestIdleCallback`. */
export function whenIdle(
  callback: () => void,
  options?: IdleRequestOptions,
): void {
  if (typeof requestIdleCallback !== "undefined") {
    requestIdleCallback(callback, options);
    return;
  }
  setTimeout(callback, 0);
}
