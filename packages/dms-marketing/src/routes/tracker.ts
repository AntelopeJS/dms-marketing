import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Context,
  Controller,
  Get,
  type RequestContext,
} from "@antelopejs/interface-api";
import { getConfig } from "@/config";
import {
  API_BASE_PATH,
  PAUSED_TRACKER_CACHE_MAX_AGE_SECONDS,
  TRACKER_CACHE_MAX_AGE_SECONDS,
} from "@/types/constants";

/** dist/routes → package root; `static` ships in the published files list. */
const TRACKER_RELATIVE_PATH = "../../static/tracker.js";

const TRACKER_CONTENT_TYPE = "application/javascript; charset=utf-8";

/** Global the served script reads its settings from (see static/tracker.js). */
const TRACKER_CONFIG_GLOBAL = "__dmsMarketingTrackerConfig";

/** Settings the tracker honors client-side. Numbers and booleans only — the
 * prelude is inlined into a script body, and neither can carry markup. */
interface ServedTrackerConfig {
  heatmapSampleRate: number;
  /**
   * Collection paused: the tracker only publishes its page API, so page code
   * calling `window.dmsMarketing.track(…)` keeps working.
   */
  paused: boolean;
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
    paused: !getConfig().trackerEnabled,
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
    const enabled = getConfig().trackerEnabled;
    const maxAge = enabled
      ? TRACKER_CACHE_MAX_AGE_SECONDS
      : PAUSED_TRACKER_CACHE_MAX_AGE_SECONDS;
    context.response.addHeader("Cache-Control", `public, max-age=${maxAge}`);
    context.response.getWriteStream(TRACKER_CONTENT_TYPE).end(servedScript());
  }
}
