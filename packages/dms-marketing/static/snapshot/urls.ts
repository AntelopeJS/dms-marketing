const OPAQUE_URL_PATTERN = /^(#|data:|blob:|about:)/i;
const SCRIPT_URL_PATTERN = /^javascript:/i;
const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]*)\1\s*\)/g;
const CSS_IMPORT_PATTERN = /@import\s+(['"])([^'"]+)\1/g;

/**
 * Absolute form, untouched for fragments and inline data, null for what must
 * not be carried (script URLs, garbage).
 */
export function absoluteUrl(value: string, base: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || OPAQUE_URL_PATTERN.test(trimmed)) {
    return trimmed;
  }
  if (SCRIPT_URL_PATTERN.test(trimmed)) {
    return null;
  }
  try {
    return new URL(trimmed, base).href;
  } catch {
    return null;
  }
}

/**
 * Links keep their target, never a query or fragment: tokens and addresses
 * ride there, and nothing in the backdrop is clickable. A masked link keeps
 * its origin alone, because a profile path names its person.
 */
export function withoutQuery(url: string, masked: boolean): string {
  try {
    const parsed = new URL(url);
    if (masked) {
      return `${parsed.origin}/`;
    }
    parsed.search = "";
    parsed.hash = "";
    return parsed.href;
  } catch {
    return url;
  }
}

export function absolutizeSrcset(value: string, base: string): string {
  return value
    .split(",")
    .map((candidate) => {
      const [url, ...descriptors] = candidate.trim().split(/\s+/);
      const absolute = url ? absoluteUrl(url, base) : null;
      return absolute ? [absolute, ...descriptors].join(" ") : "";
    })
    .filter(Boolean)
    .join(", ");
}

export function absolutizeCss(css: string, base: string): string {
  return css
    .replace(CSS_URL_PATTERN, (_match, _quote: string, url: string) => {
      const absolute = absoluteUrl(url, base);
      return absolute === null ? "url()" : `url(${JSON.stringify(absolute)})`;
    })
    .replace(CSS_IMPORT_PATTERN, (match, _quote: string, url: string) => {
      const absolute = absoluteUrl(url, base);
      return absolute === null ? match : `@import ${JSON.stringify(absolute)}`;
    });
}
