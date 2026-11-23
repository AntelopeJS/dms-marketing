/** The patterns of `data-exclude-paths`: each a path starting with "/". */
export function parseExcludedPaths(attribute: string | null): string[] {
  return (attribute || "")
    .split(",")
    .map((pattern) => pattern.trim())
    .filter((pattern) => pattern.charAt(0) === "/");
}

function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function pathMatches(pattern: string, path: string): boolean {
  if (pattern.endsWith("/**")) {
    const base = pattern.slice(0, -3);
    return path === base || path.startsWith(`${base}/`);
  }
  if (pattern.endsWith("/*")) {
    const base = pattern.slice(0, -2);
    const rest = path.startsWith(`${base}/`) ? path.slice(base.length + 1) : "";
    return rest !== "" && !rest.includes("/");
  }
  return path === withoutTrailingSlash(pattern);
}

/** Whether `pathname` is one of the pages the tag leaves uncounted: `/x` (that page), `/x/*` (one segment below) or `/x/**` (the page and everything below). */
export function isExcludedPath(
  patterns: readonly string[],
  pathname: string,
): boolean {
  const path = withoutTrailingSlash(pathname);
  return patterns.some((pattern) => pathMatches(pattern, path));
}
