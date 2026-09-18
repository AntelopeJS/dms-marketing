import {
  Context,
  Controller,
  HTTPResult,
  JSONBody,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assertValidation } from "@antelopejs/interface-api-util";
import { getConfig } from "@/config";
import { type CollectOutcome, processCollectBatch } from "@/services/collect";
import { collectRateLimiter, isAutomatedClient } from "@/services/ingest-guard";
import {
  requestSourceHostname,
  warnRejectedSource,
  websiteAcceptsHostname,
} from "@/services/origin-guard";
import { clientIp, userAgentOf } from "@/services/request-meta";
import { resolveWebsite } from "@/services/website-cache";
import { collectRequestSchema } from "@/types";
import {
  API_BASE_PATH,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
} from "@/types/constants";

const UNKNOWN_WEBSITE_MESSAGE = "unknown website";
const ORIGIN_NOT_ALLOWED_MESSAGE = "origin not allowed";

const EMPTY_OUTCOME: CollectOutcome = { accepted: 0, dropped: 0 };

/**
 * Public ingestion endpoint for the first-party tracker. No auth on purpose:
 * identity is reduced to the anonymous visitor hash server-side, the website
 * id acts as the collection key, and payloads are strictly validated and
 * size-capped. Gated by origin, bot and rate guards; refusals past the
 * origin check are silent 200s.
 */
export class CollectController extends Controller(API_BASE_PATH) {
  @Post("collect")
  async collect(@JSONBody() body: unknown, @Context() context: RequestContext) {
    if (!getConfig().trackerEnabled) {
      return EMPTY_OUTCOME;
    }
    // zod v3 binds `parse` to its schema in the ZodType constructor, so the
    // reference passed here is not actually unbound.
    // oxlint-disable-next-line typescript/unbound-method
    const data = assertValidation(body, collectRequestSchema.parse);
    const website = await resolveWebsite(data.website);
    if (!website || !website.trackingEnabled) {
      throw new HTTPResult(HTTP_NOT_FOUND, UNKNOWN_WEBSITE_MESSAGE);
    }
    const source = requestSourceHostname(context.rawRequest.headers);
    if (source !== undefined && !websiteAcceptsHostname(website, source)) {
      warnRejectedSource(website._id, source);
      throw new HTTPResult(HTTP_FORBIDDEN, ORIGIN_NOT_ALLOWED_MESSAGE);
    }
    const userAgent = userAgentOf(context);
    const ip = clientIp(context);
    if (
      isAutomatedClient(userAgent) ||
      !collectRateLimiter.consume(`${website._id}\n${ip}`, data.events.length)
    ) {
      return { accepted: 0, dropped: data.events.length };
    }
    return processCollectBatch(website, data.events, { ip, userAgent });
  }
}
