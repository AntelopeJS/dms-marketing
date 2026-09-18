import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Context,
  Controller,
  Get,
  HTTPResult,
  type RequestContext,
} from "@antelopejs/interface-api";
import { getConfig } from "@/config";
import {
  API_BASE_PATH,
  HTTP_NOT_FOUND,
  TRACKER_CACHE_MAX_AGE_SECONDS,
} from "@/types/constants";

/** dist/routes → package root; `static` ships in the published files list. */
const TRACKER_RELATIVE_PATH = "../../static/tracker.js";

const TRACKER_CONTENT_TYPE = "application/javascript; charset=utf-8";

/** Global the served script reads its settings from (see static/tracker.js). */
const TRACKER_CONFIG_GLOBAL = "__dmsMarketingTrackerConfig";

/** Settings the tracker honors client-side. Numbers only — the prelude is
 * inlined into a script body, and a number can carry no markup. */
interface ServedTrackerConfig {
  heatmapSampleRate: number;
}

let cachedScript: string | null = null;

function loadScript(): string {
  if (cachedScript === null) {
    cachedScript = readFileSync(
      path.join(__dirname, TRACKER_RELATIVE_PATH),
      "utf8",
    );
  }
  return cachedScript;
}

/**
 * The script file is static, its configuration is not: the effective settings
 * are prepended per request so the Settings page drives the tracker instead of
 * the hard-coded defaults. Client caching delays propagation by at most
 * TRACKER_CACHE_MAX_AGE_SECONDS.
 */
function servedScript(): string {
  const config: ServedTrackerConfig = {
    heatmapSampleRate: getConfig().heatmapSampleRate,
  };
  return `window.${TRACKER_CONFIG_GLOBAL}=${JSON.stringify(config)};\n${loadScript()}`;
}

/**
 * Serves the first-party tracker from the DMS's own origin, so client sites
 * embed `<script src=".../api/marketing/tracker.js" data-website-id="…">` —
 * no third-party host, no ad-blocker bait domain.
 */
export class TrackerController extends Controller(API_BASE_PATH) {
  @Get("tracker.js")
  async tracker(@Context() context: RequestContext) {
    if (!getConfig().trackerEnabled) {
      throw new HTTPResult(HTTP_NOT_FOUND);
    }
    context.response.addHeader(
      "Cache-Control",
      `public, max-age=${TRACKER_CACHE_MAX_AGE_SECONDS}`,
    );
    context.response.getWriteStream(TRACKER_CONTENT_TYPE).end(servedScript());
  }
}
