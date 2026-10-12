import { HTTPResult } from "@antelopejs/interface-api";
import { HTTP_BAD_REQUEST } from "@/types/constants";

const INVALID_BODY_MESSAGE = "invalid body";

/**
 * A `@RawBody` buffer parsed as JSON. A body that is not JSON is the
 * caller's mistake: 400 with `message`, where `@JSONBody` answers 500.
 */
export function parseJsonOr400(
  body: Buffer,
  message: string = INVALID_BODY_MESSAGE,
): unknown {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HTTPResult(HTTP_BAD_REQUEST, message);
  }
}
