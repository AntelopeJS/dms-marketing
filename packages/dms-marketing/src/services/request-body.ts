import { gunzipSync } from "node:zlib";
import { HTTPResult } from "@antelopejs/interface-api";
import { assertValidation } from "@antelopejs/interface-api-util";
import type { z } from "zod";
import { HTTP_BAD_REQUEST, HTTP_PAYLOAD_TOO_LARGE } from "@/types/constants";

const INVALID_BODY_MESSAGE = "invalid body";
const TOO_LARGE_MESSAGE = "payload too large";
/** The gzip header: no JSON text starts with it. */
const GZIP_MAGIC = [0x1f, 0x8b];

/**
 * A `@RawBody` buffer that may come gzipped (the snapshot upload, where the
 * browser has CompressionStream: a no-cors request cannot say so in a
 * header, so the gzip header tells). Inflated up to `maxInflatedBytes`,
 * 413 past it — a small body never inflates into an unbounded one — and 400
 * when it is not valid gzip. Any other body comes back as it is.
 */
export function inflateIfGzipped(
  body: Buffer,
  maxInflatedBytes: number,
): Buffer {
  if (body[0] !== GZIP_MAGIC[0] || body[1] !== GZIP_MAGIC[1]) {
    return body;
  }
  try {
    return gunzipSync(body, { maxOutputLength: maxInflatedBytes });
  } catch (err) {
    if (
      err instanceof Error &&
      "code" in err &&
      err.code === "ERR_BUFFER_TOO_LARGE"
    ) {
      throw new HTTPResult(HTTP_PAYLOAD_TOO_LARGE, TOO_LARGE_MESSAGE);
    }
    throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_BODY_MESSAGE);
  }
}

/**
 * A size-capped `@RawBody` buffer (collect, snapshot) parsed as JSON and
 * validated against `schema`. A body that is not JSON is the caller's
 * mistake: 400, as `@JSONBody` answers on the routes without a cap of their
 * own; so is one the schema refuses, as `assertValidation` answers.
 */
export function parseJsonOr400<Output>(
  body: Buffer,
  schema: z.ZodType<Output, z.ZodTypeDef, unknown>,
): Output {
  let json: unknown;
  try {
    json = JSON.parse(body.toString("utf8"));
  } catch {
    throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_BODY_MESSAGE);
  }
  return assertValidation(json, (value) => schema.parse(value));
}
