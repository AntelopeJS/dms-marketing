import { isString } from "@/utils/guards";

/**
 * A query parameter as the handlers receive it: `@Parameter(name, "query")`
 * gives `undefined` when it is absent and `true` when it is empty
 * (`?search=`), `URLSearchParams.get` gives `null` when it is absent.
 */
export type QueryParameter = string | true | null | undefined;

/**
 * Normalizes a query parameter into the string the handlers assume: absent
 * and empty (`?search=`) both collapse to `undefined`. An empty parameter is
 * typed `string | undefined` but arrives as `true`, without `String` methods,
 * so `.trim()`/`.match()` on it would 500 on a legitimate request.
 */
export function queryString(value: QueryParameter): string | undefined {
  if (!isString(value)) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
