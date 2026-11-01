import { getClientIp } from "@antelopejs/interface-dms/client-ip";
import {
  Context,
  Controller,
  HTTPResult,
  Post,
  RawBody,
  type RequestContext,
} from "@antelopejs/interface-api";
import { getConfig } from "@/config";
import { processCollectBatch } from "@/services/collect";
import { collectRateLimiter, isAutomatedClient } from "@/services/ingest-guard";
import {
  requestSourceHostname,
  warnRejectedSource,
  websiteAcceptsHostname,
} from "@/services/origin-guard";
import { parseJsonOr400 } from "@/services/request-body";
import { userAgentOf } from "@/services/request-meta";
import { resolveWebsite } from "@/services/website-cache";
import { recordAcceptedSource } from "@/services/website-hosts";
import { collectRequestSchema } from "@/types";
import {
  API_BASE_PATH,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  MAX_COLLECT_BODY_BYTES,
} from "@/types/constants";

const UNKNOWN_WEBSITE_MESSAGE = "unknown website";
const ORIGIN_NOT_ALLOWED_MESSAGE = "origin not allowed";

/**
 * Public ingestion endpoint for the first-party tracker. No auth on purpose:
 * identity is reduced to the anonymous visitor hash server-side, the website
 * id acts as the collection key, and payloads are strictly validated and
 * size-capped (`@RawBody` answers 413 past the cap). Gated by origin, bot
 * and rate guards; refusals past the origin check are silent 200s counting
 * every event as dropped.
 */
export class CollectController extends Controller(API_BASE_PATH) {
  @Post("collect")
  async collect(
    @Context() context: RequestContext,
    @RawBody(MAX_COLLECT_BODY_BYTES) body: Buffer,
  ) {
    const data = parseJsonOr400(body, collectRequestSchema);
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
    const ip = await getClientIp(context);
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
