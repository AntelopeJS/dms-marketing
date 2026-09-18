import { HTTPResult } from "@antelopejs/interface-api";
import { HTTP_BAD_REQUEST } from "@/types/constants";

const INVALID_BODY_MESSAGE = "$page.marketing.errors.invalid_body";

/** Shared by the data-api write wrappers, which all re-read the raw body. */
export function parseBody(body: Buffer | string): Record<string, unknown> {
  try {
    return JSON.parse(
      typeof body === "string" ? body : body.toString(),
    ) as Record<string, unknown>;
  } catch {
    throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_BODY_MESSAGE);
  }
}
