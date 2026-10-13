import { HTTPResult } from "@antelopejs/interface-api";
import { HTTP_BAD_REQUEST } from "@/types/constants";

const INVALID_BODY_MESSAGE = "invalid body";

/**
 * A size-capped `@RawBody` buffer (collect, snapshot) parsed as JSON. A body
 * that is not JSON is the caller's mistake: 400, as `@JSONBody` answers on
 * the routes without a cap of their own.
 */
export function parseJsonOr400(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_BODY_MESSAGE);
  }
}
