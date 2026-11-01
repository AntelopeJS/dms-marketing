import type { JsonValue } from "@antelopejs/interface-dms-marketing";

export type {
  JsonObject,
  JsonValue,
} from "@antelopejs/interface-dms-marketing";

/**
 * A request body as `@JSONBody()` hands it over: the parsed JSON, or
 * `undefined` when the request carried no body.
 */
export type JsonBody = JsonValue | undefined;
