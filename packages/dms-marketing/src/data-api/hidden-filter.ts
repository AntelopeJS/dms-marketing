import { Filter } from "@antelopejs/interface-data-api/metadata";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";

const STRING_TYPE = new DefaultDataTypes.StringType();

/**
 * Registers a string filter on a field without exposing a visible `@Column`:
 * the data-api drops any filter (e.g. the forced tenantId) whose field is not
 * in its filter map.
 */
export function HiddenStringFilter(): PropertyDecorator {
  const filter = STRING_TYPE.filter.bind(STRING_TYPE);
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- `Filter` returns a decorator typed for a `Record<string, unknown>` target, which `PropertyDecorator`'s `Object` target does not satisfy, and the two types do not overlap
  return Filter(filter) as unknown as PropertyDecorator;
}
