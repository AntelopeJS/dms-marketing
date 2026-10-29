/** A value as JSON carries it. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * A request body as `@JSONBody()` hands it over: the parsed JSON, or
 * `undefined` when the request carried no body.
 */
export type JsonBody = JsonValue | undefined;
