import { Filter } from "@antelopejs/interface-data-api/metadata";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";

const STRING_TYPE = new DefaultDataTypes.StringType();

/**
 * Registers a string filter on a field without exposing a visible `@Column`:
 * the data-api drops any filter (e.g. the forced tenantId) whose field is not
 * in its filter map.
 */
export function HiddenStringFilter() {
  return Filter((...args) => STRING_TYPE.filter(...args));
}
