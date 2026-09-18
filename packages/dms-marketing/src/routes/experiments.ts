import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  type RequestContext,
} from "@antelopejs/interface-api";
import { getConfig } from "@/config";
import { servableExperiments } from "@/services/experiment-definitions";
import { type AssignmentMap, assignAll } from "@/services/experiments";
import { queryString } from "@/services/query-param";
import { clientIp, userAgentOf } from "@/services/request-meta";
import { getVisitorHashSecret } from "@/services/settings";
import { computeVisitorId } from "@/services/visitor-id";
import {
  API_BASE_PATH,
  HTTP_BAD_REQUEST,
  MAX_WEBSITE_ID_LENGTH,
} from "@/types/constants";

/** Absent parameter is an integration error, not a visitor state — the one
 * case that answers with a status instead of an empty map. Public surface:
 * plain English, not an i18n key no client site could resolve. */
const MISSING_WEBSITE_MESSAGE = "website query parameter is required";

const SCRIPT_CONTENT_TYPE = "application/javascript; charset=utf-8";

/** Global the tracker's variation() reads (and deletes) after loading. */
const ASSIGNMENTS_GLOBAL = "__dmsMarketingAssignments";

/** The body is per-visitor (derived from IP + UA): a shared cache keyed on
 * the URL would hand the first visitor's buckets to everyone after them. */
const NO_STORE_CACHE_CONTROL = "private, no-store";

/** JSON is not quite JS: U+2028/U+2029 are legal in JSON strings but
 * terminate a line inside a script body. */
function toScriptLiteral(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/**
 * Public per-visitor assignments, served as a script rather than JSON: a
 * `<script src>` needs no CORS grant, which keeps the "client sites need no
 * CORS grant" contract that a readable cross-origin fetch would break. The
 * visitor id derives from the request's IP and user agent — same inputs as
 * collect — so assignment is browser-side by contract: an SSR fetch would
 * put every visitor of the site behind the renderer's single identity.
 */
export class PublicExperimentsController extends Controller(API_BASE_PATH) {
  @Get("experiments.js")
  async assignments(
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
  ) {
    const id = queryString(website);
    if (id === undefined) {
      throw new HTTPResult(HTTP_BAD_REQUEST, MISSING_WEBSITE_MESSAGE);
    }
    let assignments: AssignmentMap = {};
    // An over-long id can never match a website: refuse it a cache slot too.
    if (getConfig().trackerEnabled && id.length <= MAX_WEBSITE_ID_LENGTH) {
      const running = await servableExperiments(id);
      if (running.length > 0) {
        const visitorId = computeVisitorId(
          getVisitorHashSecret(),
          id,
          clientIp(context),
          userAgentOf(context),
        );
        assignments = assignAll(visitorId, running);
      }
    }
    context.response.addHeader("Cache-Control", NO_STORE_CACHE_CONTROL);
    context.response
      .getWriteStream(SCRIPT_CONTENT_TYPE)
      .end(`window.${ASSIGNMENTS_GLOBAL}=${toScriptLiteral(assignments)};`);
  }
}
