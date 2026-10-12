import {
  Context,
  Controller,
  HTTPResult,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assertValidation } from "@antelopejs/interface-api-util";
import { getConfig } from "@/config";
import { processCollectBatch } from "@/services/collect";
import { collectRateLimiter, isAutomatedClient } from "@/services/ingest-guard";
import {
  requestSourceHostname,
  warnRejectedSource,
  websiteAcceptsHostname,
} from "@/services/origin-guard";
import { readBoundedBody } from "@/services/request-body";
import { clientIp, userAgentOf } from "@/services/request-meta";
import { resolveWebsite } from "@/services/website-cache";
import { recordAcceptedSource } from "@/services/website-hosts";
import { collectRequestSchema } from "@/types";
import {
  API_BASE_PATH,
  HTTP_BAD_REQUEST,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_PAYLOAD_TOO_LARGE,
  MAX_COLLECT_BODY_BYTES,
} from "@/types/constants";

const UNKNOWN_WEBSITE_MESSAGE = "unknown website";
const ORIGIN_NOT_ALLOWED_MESSAGE = "origin not allowed";
const PAYLOAD_TOO_LARGE_MESSAGE = "batch too large";
const INVALID_BODY_MESSAGE = "invalid body";

/** Read under a cap and parsed here rather than through `@JSONBody`, whose
 * parse error surfaces as a 500 carrying the parser's message. */
async function readJsonBody(context: RequestContext): Promise<unknown> {
  const body = await readBoundedBody(context, MAX_COLLECT_BODY_BYTES);
  if (!body) {
    throw new HTTPResult(HTTP_PAYLOAD_TOO_LARGE, PAYLOAD_TOO_LARGE_MESSAGE);
  }
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_BODY_MESSAGE);
  }
}

/**
 * Public ingestion endpoint for the first-party tracker. No auth on purpose:
 * identity is reduced to the anonymous visitor hash server-side, the website
 * id acts as the collection key, and payloads are strictly validated and
 * size-capped. Gated by origin, bot and rate guards; refusals past the
 * origin check are silent 200s counting every event as dropped.
 */
export class CollectController extends Controller(API_BASE_PATH) {
  @Post("collect")
  async collect(@Context() context: RequestContext) {
    const body = await readJsonBody(context);
    // zod v3 binds `parse` to its schema in the ZodType constructor, so the
    // reference passed here is not actually unbound.
    // oxlint-disable-next-line typescript/unbound-method
    const data = assertValidation(body, collectRequestSchema.parse);
    const refused = { accepted: 0, dropped: data.events.length };
    if (!getConfig().trackerEnabled) {
      return refused;
    }
    const website = await resolveWebsite(data.website);
    if (!website || !website.trackingEnabled) {
      throw new HTTPResult(HTTP_NOT_FOUND, UNKNOWN_WEBSITE_MESSAGE);
    }
    const headers = context.rawRequest.headers;
    const source = requestSourceHostname(headers);
    if (source !== undefined && !websiteAcceptsHostname(website, source)) {
      warnRejectedSource(website._id, source, headers);
      throw new HTTPResult(HTTP_FORBIDDEN, ORIGIN_NOT_ALLOWED_MESSAGE);
    }
    const userAgent = userAgentOf(context);
    const ip = clientIp(context);
    // Every browser stamps Origin on a POST; a beacon without it (nor a
    // Referer) was not sent by a page of the site.
    if (
      source === undefined ||
      isAutomatedClient(userAgent) ||
      !collectRateLimiter.consume(`${website._id}\n${ip}`, data.events.length)
    ) {
      return refused;
    }
    recordAcceptedSource(website._id, source);
    return processCollectBatch(website, data.events, { ip, userAgent });
  }
}
