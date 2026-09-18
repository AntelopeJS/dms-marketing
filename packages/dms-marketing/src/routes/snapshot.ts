import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assertValidation } from "@antelopejs/interface-api-util";
import { getConfig } from "@/config";
import type { Website } from "@/db/tables/websites.table";
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
import { readBoundedBody } from "@/services/request-body";
import { clientIp, userAgentOf } from "@/services/request-meta";
import { storeSnapshot, wantsSnapshot } from "@/services/snapshots";
import { parseTrackedUrl } from "@/services/url";
import { resolveWebsite } from "@/services/website-cache";
import { snapshotRequestSchema } from "@/types";
import {
  API_BASE_PATH,
  HTTP_BAD_REQUEST,
  HTTP_FORBIDDEN,
  HTTP_NOT_FOUND,
  HTTP_PAYLOAD_TOO_LARGE,
  MAX_SNAPSHOT_BYTES,
  MAX_URL_LENGTH,
} from "@/types/constants";

/** dist/routes → package root; `static` ships in the published files list. */
const SNAPSHOT_SCRIPT_RELATIVE_PATH = "../../static/snapshot.js";
const SCRIPT_CONTENT_TYPE = "application/javascript; charset=utf-8";
/** Global the served capture script reads its settings from. */
const SNAPSHOT_CONFIG_GLOBAL = "__dmsMarketingSnapshotConfig";
/** Per page and per visit, never shared: the answer is a decision, not a file. */
const NO_STORE = "private, no-store";

const UNKNOWN_WEBSITE_MESSAGE = "unknown website";
const ORIGIN_NOT_ALLOWED_MESSAGE = "origin not allowed";
const PAYLOAD_TOO_LARGE_MESSAGE = "snapshot too large";
const INVALID_BODY_MESSAGE = "invalid body";

const REFUSED = { accepted: false };

/** Settings the capture honors. Scalars only — inlined into a script body. */
interface ServedSnapshotConfig {
  maskText: boolean;
  maxBytes: number;
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

function servedScript(website: Website): string {
  const config: ServedSnapshotConfig = {
    maskText: website.snapshotMaskText === true,
    maxBytes: MAX_SNAPSHOT_BYTES,
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

function parseJson(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_BODY_MESSAGE);
  }
}

/**
 * Page snapshots — public like collect, guarded like it (origin, bot, rate).
 * The two halves of one negotiation: a sampled visit asks whether a capture
 * is wanted and receives the capture script only then, so no visit ever
 * uploads a snapshot that would be discarded.
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
  ) {
    const body = await this.negotiatedScript(context, website, pathname, width);
    context.response.addHeader("Cache-Control", NO_STORE);
    context.response.getWriteStream(SCRIPT_CONTENT_TYPE).end(body);
  }

  private async negotiatedScript(
    context: RequestContext,
    website: unknown,
    pathname: unknown,
    width: unknown,
  ): Promise<string> {
    const websiteId = queryString(website);
    const url = trackedPath(pathname);
    const viewportWidth = Number.parseInt(queryString(width) ?? "", 10);
    if (
      !getConfig().trackerEnabled ||
      !websiteId ||
      !url ||
      !Number.isFinite(viewportWidth)
    ) {
      return "";
    }
    const site = await resolveWebsite(websiteId);
    if (!site || !site.trackingEnabled || !site.snapshotsEnabled) {
      return "";
    }
    const source = requestSourceHostname(context.rawRequest.headers);
    if (source !== undefined && !websiteAcceptsHostname(site, source)) {
      return "";
    }
    if (isAutomatedClient(userAgentOf(context))) {
      return "";
    }
    return (await wantsSnapshot(site, url, viewportWidth))
      ? servedScript(site)
      : "";
  }

  /**
   * text/plain JSON like collect (no preflight). The body is read under a
   * hard cap before anything parses it; refusals past the origin check are
   * silent 200s, as on collect.
   */
  @Post("snapshot")
  async upload(@Context() context: RequestContext) {
    if (!getConfig().trackerEnabled) {
      return REFUSED;
    }
    const body = await readBoundedBody(context, MAX_SNAPSHOT_BYTES);
    if (!body) {
      throw new HTTPResult(HTTP_PAYLOAD_TOO_LARGE, PAYLOAD_TOO_LARGE_MESSAGE);
    }
    // zod v3 binds `parse` to its schema in the ZodType constructor, so the
    // reference passed here is not actually unbound.
    // oxlint-disable-next-line typescript/unbound-method
    const data = assertValidation(parseJson(body), snapshotRequestSchema.parse);
    const website = await resolveWebsite(data.website);
    if (!website || !website.trackingEnabled) {
      throw new HTTPResult(HTTP_NOT_FOUND, UNKNOWN_WEBSITE_MESSAGE);
    }
    const source = requestSourceHostname(context.rawRequest.headers);
    if (source !== undefined && !websiteAcceptsHostname(website, source)) {
      warnRejectedSource(website._id, source);
      throw new HTTPResult(HTTP_FORBIDDEN, ORIGIN_NOT_ALLOWED_MESSAGE);
    }
    if (
      !website.snapshotsEnabled ||
      isAutomatedClient(userAgentOf(context)) ||
      !snapshotRateLimiter.consume(`${website._id}\n${clientIp(context)}`, 1)
    ) {
      return REFUSED;
    }
    return { accepted: await storeSnapshot(website, data) };
  }
}
