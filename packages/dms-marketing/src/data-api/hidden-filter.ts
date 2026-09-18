import {
  Filter,
  type FilterFunction,
} from "@antelopejs/interface-data-api/metadata";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";

const STRING_TYPE = new DefaultDataTypes.StringType();

/**
 * Registers a string filter on a field without exposing a visible `@Column`:
 * the data-api drops any filter (e.g. the forced tenantId) whose field is not
 * in its filter map. The cast is needed because `@Filter`'s generic targets
 * `Record<string, any>`, which a class property does not satisfy.
 */
export function HiddenStringFilter(): PropertyDecorator {
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  const filter = STRING_TYPE.filter.bind(
    STRING_TYPE,
  ) as unknown as FilterFunction<Record<string, unknown>>;
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions
  return Filter(filter) as unknown as PropertyDecorator;
}
