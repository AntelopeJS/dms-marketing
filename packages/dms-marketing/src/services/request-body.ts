import type { RequestContext } from "@antelopejs/interface-api";

/**
 * The whole request body, or undefined past `maxBytes`. The framework's
 * ReadBody buffers without a cap, so a public endpoint taking large payloads
 * reads the stream itself: a declared length past the cap is refused before
 * a byte is read, an undeclared one is cut the moment it crosses it.
 */
export function readBoundedBody(
  context: RequestContext,
  maxBytes: number,
): Promise<Buffer | undefined> {
  const request = context.rawRequest;
  const declared = Number(request.headers["content-length"]);
  if (Number.isFinite(declared) && declared > maxBytes) {
    return Promise.resolve(undefined);
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let cut = false;
    request.on("data", (chunk: Buffer) => {
      if (cut) {
        return;
      }
      size += chunk.length;
      if (size > maxBytes) {
        cut = true;
        request.destroy();
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!cut) {
        resolve(Buffer.concat(chunks));
      }
    });
    request.on("error", (err) => {
      if (cut) {
        resolve(undefined);
        return;
      }
      reject(err);
    });
  });
}
