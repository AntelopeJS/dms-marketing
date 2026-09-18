/**
 * Normalizes a query parameter into the string the handlers assume: absent
 * and empty (`?search=`) both collapse to `undefined`. An empty parameter is
 * typed `string | undefined` but arrives without `String` methods, so
 * `.trim()`/`.match()` on it would 500 on a legitimate request.
 */
export function queryString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
