import { getClientIp } from "@antelopejs/interface-dms/client-ip";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  Post,
  RawBody,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assertValidation } from "@antelopejs/interface-api-util";
import { getConfig } from "@/config";
import type { Website } from "@/db/tables/websites.table";
import { hidesDashboardPath } from "@/services/dashboard-tracking";
import {
  isAutomatedClient,
  snapshotRateLimiter,
} from "@/services/ingest-guard";
import {
  requestSourceHostname,
  warnRejectedSource,
  websiteAcceptsHostname,
} from "@/services/origin-guard";
import { queryString } from "@/services/query-param";
import { inflateIfGzipped, parseJsonOr400 } from "@/services/request-body";
import { userAgentOf } from "@/services/request-meta";
import { getVisitorHashSecret } from "@/services/settings";
import { storeSnapshot, wantsSnapshot } from "@/services/snapshots";
import { parseTrackedUrl } from "@/services/url";
import { computeVisitorId } from "@/services/visitor-id";
import { resolveWebsite } from "@/services/website-cache";
import { snapshotRequestSchema } from "@/types";
import {
  API_BASE_PATH,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_PAYLOAD_TOO_LARGE,
  MAX_SNAPSHOT_INFLATED_BYTES,
  MAX_SNAPSHOT_MAX_BYTES,
  MAX_URL_LENGTH,
} from "@/types/constants";

/** dist/routes → package root; `static` ships in the published files list. */
const SNAPSHOT_SCRIPT_RELATIVE_PATH = "../../static/snapshot.js";
const SCRIPT_CONTENT_TYPE = "application/javascript; charset=utf-8";
/** Global the served capture script reads its settings from. */
const SNAPSHOT_CONFIG_GLOBAL = "__dmsMarketingSnapshotConfig";
/** Per page and per visit, never shared: the answer is a decision, not a file. */
const SCROLL_ROOT_FLAG = "1";
const NO_STORE = "private, no-store";

const UNKNOWN_WEBSITE_MESSAGE = "unknown website";
const ORIGIN_NOT_ALLOWED_MESSAGE = "origin not allowed";
const TOO_LARGE_MESSAGE = "payload too large";

const REFUSED = { accepted: false };

/** Settings the capture honors. Scalars only — inlined into a script body
 * (the token is hex). */
interface ServedSnapshotConfig {
  maskText: boolean;
  maxBytes: number;
  token: string;
}

/** The negotiation's query, as received. `root=1`: the tracker sees the page
 * scroll an inner container (see wantsSnapshot). */
interface NegotiationQuery {
  website: unknown;
  pathname: unknown;
  width: unknown;
  scrollRoot: boolean;
}

let cachedScript: string | null = null;

function loadScript(): string {
  if (cachedScript === null) {
    cachedScript = readFileSync(
      path.join(__dirname, SNAPSHOT_SCRIPT_RELATIVE_PATH),
      "utf8",
    );
  }
  return cachedScript;
}

function servedScript(website: Website, token: string): string {
  const config: ServedSnapshotConfig = {
    maskText: website.snapshotMaskText === true,
    maxBytes: getConfig().snapshotMaxBytes,
    token,
  };
  return `window.${SNAPSHOT_CONFIG_GLOBAL}=${JSON.stringify(config)};\n${loadScript()}`;
}

/** The tracker sends a bare pathname; it goes through the same reduction as
 * a tracked URL at ingestion, so the key matches the events' one. */
function trackedPath(raw: unknown): string | undefined {
  const value = queryString(raw);
  if (!value || !value.startsWith("/") || value.length > MAX_URL_LENGTH) {
    return undefined;
  }
  return parseTrackedUrl(value).path;
}

/** Same identity as collect's, so the upload can be matched to the visit
 * that negotiated it. */
function visitorOf(
  context: RequestContext,
  website: Website,
  ip: string,
): string {
  return computeVisitorId(
    getVisitorHashSecret(),
    website._id,
    ip,
    userAgentOf(context),
  );
}

/**
 * Page snapshots — public like collect, guarded like it (origin, bot, rate).
 * The two halves of one negotiation: a sampled visit asks whether a capture
 * is wanted and receives the capture script only then, with a token the
 * upload must return — so no visit ever uploads a snapshot that would be
 * discarded, and nothing uploads one it was not asked for.
 */
export class SnapshotController extends Controller(API_BASE_PATH) {
  /**
   * Every refusal is the empty script: a page has nothing to do with the
   * reason, and an empty answer costs it nothing.
   */
  @Get("snapshot.js")
  async negotiate(
    @Context() context: RequestContext,
    @Parameter("website", "query") website?: string,
    @Parameter("path", "query") pathname?: string,
    @Parameter("width", "query") width?: string,
    @Parameter("root", "query") root?: string,
  ) {
    const body = await this.negotiatedScript(context, {
      website,
      pathname,
      width,
      scrollRoot: queryString(root) === SCROLL_ROOT_FLAG,
    });
    context.response.addHeader("Cache-Control", NO_STORE);
    context.response.getWriteStream(SCRIPT_CONTENT_TYPE).end(body);
  }

  private async negotiatedScript(
    context: RequestContext,
    query: NegotiationQuery,
  ): Promise<string> {
    const websiteId = queryString(query.website);
    const url = trackedPath(query.pathname);
    const viewportWidth = Number.parseInt(queryString(query.width) ?? "", 10);
    if (
      !getConfig().trackerEnabled ||
      !websiteId ||
      !url ||
      !Number.isFinite(viewportWidth)
    ) {
      return "";
    }
    const site = await resolveWebsite(websiteId);
    if (
      !site ||
      !site.trackingEnabled ||
      !site.snapshotsEnabled ||
      hidesDashboardPath(site, url)
    ) {
      return "";
    }
    const source = requestSourceHostname(context.rawRequest.headers);
    if (source !== undefined && !websiteAcceptsHostname(site, source)) {
      return "";
    }
    if (isAutomatedClient(userAgentOf(context))) {
      return "";
    }
    const token = await wantsSnapshot(
      site,
      url,
      viewportWidth,
      visitorOf(context, site, await getClientIp(context)),
      query.scrollRoot,
    );
    return token ? servedScript(site, token) : "";
  }

  /**
   * text/plain JSON like collect (no preflight), gzipped when the browser
   * can compress it. `@RawBody` reads the body under the highest cap
   * `snapshotMaxBytes` may take, then the configured one applies to the body
   * as it came (413 past either), and a gzipped body inflates under a cap
   * of its own before anything parses it; refusals past
   * the origin check are silent 200s, as on collect — headerless uploads
   * included, since the capture script's fetch always carries an Origin.
   */
  @Post("snapshot")
  async upload(
    @Context() context: RequestContext,
    @RawBody(MAX_SNAPSHOT_MAX_BYTES) body: Buffer,
  ) {
    const config = getConfig();
    if (!config.trackerEnabled) {
      return REFUSED;
    }
    if (body.length > config.snapshotMaxBytes) {
      throw new HTTPResult(HTTP_PAYLOAD_TOO_LARGE, TOO_LARGE_MESSAGE);
    }
    const json = parseJsonOr400(
      inflateIfGzipped(body, MAX_SNAPSHOT_INFLATED_BYTES),
    );
    // zod v3 binds `parse` to its schema in the ZodType constructor, so the
    // reference passed here is not actually unbound.
    // oxlint-disable-next-line typescript/unbound-method
    const data = assertValidation(json, snapshotRequestSchema.parse);
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
    const ip = await getClientIp(context);
    if (
      source === undefined ||
      !website.snapshotsEnabled ||
      hidesDashboardPath(website, parseTrackedUrl(data.url).path) ||
      isAutomatedClient(userAgentOf(context)) ||
      !snapshotRateLimiter.consume(`${website._id}\n${ip}`, 1)
    ) {
      return REFUSED;
    }
    return {
      accepted: await storeSnapshot(
        website,
        data,
        visitorOf(context, website, ip),
      ),
    };
  }
}
