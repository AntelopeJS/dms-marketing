/** Base for parsing a path typed without its scheme and host. */
const PATH_BASE = "http://step.invalid";

/** A final `*` turns a page step into a prefix: `/blog/*`. */
export const STEP_PREFIX_WILDCARD = "*";

const SCHEME_PATTERN = /^[a-z][a-z\d+.-]*:\/\//i;
/** A host pasted without its scheme: a dotted name before the first slash. */
const BARE_HOST_PATTERN = /^[^/\s?#]+\.[^/\s?#]+\//;

/**
 * A page step the way the collector stores paths (`url.pathname`): what a
 * marketer pastes — a full URL, a host glued to the path, a query string or a
 * fragment — comes down to the path. A trailing slash goes too, except on the
 * root, and a final `*` is kept as a prefix wildcard. The case is kept for
 * display; matching ignores it.
 */
export function normalizeStepPath(raw: string): string {
  const value = raw.trim();
  const prefix = value.endsWith(STEP_PREFIX_WILDCARD);
  const body = prefix ? value.slice(0, -STEP_PREFIX_WILDCARD.length) : value;
  const absolute = SCHEME_PATTERN.test(body)
    ? body
    : BARE_HOST_PATTERN.test(body)
      ? `https://${body}`
      : `${PATH_BASE}${body.startsWith("/") ? "" : "/"}${body}`;
  let path: string;
  try {
    path = new URL(absolute).pathname;
  } catch {
    return value;
  }
  if (prefix) {
    return `${path}${STEP_PREFIX_WILDCARD}`;
  }
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

/** Comparable form of a stored or normalized path: lowercase, no trailing slash. */
export function pathKey(path: string): string {
  const lower = path.toLowerCase();
  return lower.length > 1 && lower.endsWith("/") ? lower.slice(0, -1) : lower;
}

/** Whether a stored pageview path matches a page step's value. */
export function stepPathMatcher(value: string): (path: string) => boolean {
  const normalized = normalizeStepPath(value);
  if (normalized.endsWith(STEP_PREFIX_WILDCARD)) {
    const prefix = normalized
      .slice(0, -STEP_PREFIX_WILDCARD.length)
      .toLowerCase();
    return (path) => path.toLowerCase().startsWith(prefix);
  }
  const key = pathKey(normalized);
  return (path) => pathKey(path) === key;
}
