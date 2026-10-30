import { HTTPResult } from "@antelopejs/interface-api";
import { HTTP_BAD_REQUEST } from "@/types/constants";
import type { JsonObject } from "@/types/json";
import { isJsonObject, isString } from "@/utils/guards";

const INVALID_BODY_MESSAGE = "$page.marketing.errors.invalid_body";

function invalidBody(): HTTPResult {
  return new HTTPResult(HTTP_BAD_REQUEST, INVALID_BODY_MESSAGE);
}

/** Shared by the data-api write wrappers, which all re-read the raw body. */
export function parseBody(body: Buffer | string): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(isString(body) ? body : body.toString());
  } catch {
    throw invalidBody();
  }
  if (!isJsonObject(parsed)) {
    throw invalidBody();
  }
  return parsed;
}
