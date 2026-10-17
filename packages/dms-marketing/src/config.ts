import { defu } from "defu";
import {
  DEFAULT_HEATMAP_SAMPLE_RATIO,
  DEFAULT_RAW_EVENTS_RETENTION_MS,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_SNAPSHOT_RETENTION_MS,
  DEFAULT_STATISTICS_RETENTION_MS,
  MAX_NAME_LENGTH,
} from "./types/constants";

/**
 * Tracking of the dashboard's own pages, for demos, playgrounds and back
 * offices that want usage analytics of their admin without writing a tag.
 */
export interface DashboardTrackingConfig {
  /** Off by default: nothing is provisioned, injected or collected. */
  enabled: boolean;
  /** Name the provisioned website gets; an existing one keeps its own. */
  websiteName: string;
  /**
   * Dashboard pages left uncounted, beside the sign-in pages (`/auth/**`),
   * which never are: `/x` (that page), `/x/*` (one segment below) or
   * `/x/**` (the page and everything below).
   */
  excludePaths: string[];
}

export interface DmsMarketingConfig {
  trackerEnabled: boolean;
  rawEventsRetention: number;
  statisticsRetention: number;
  /**
   * Page snapshots hold page content, so they get a retention of their own,
   * shorter than the clicks drawn over them if wanted — never longer: the
   * prune bounds it by `rawEventsRetention`.
   */
  snapshotRetention: number;
  sessionIdleTimeout: number;
  heatmapSampleRate: number;
  /**
   * Feeds the visitor-hash salt. Empty uses the secret generated and
   * persisted at first start; set explicitly when running several instances.
   */
  visitorHashSecret: string;
  /**
   * Absolute path of a MaxMind country database (`.mmdb`). Opt-in on
   * purpose: the module ships no GeoIP data, so the operator who mounts a
   * database (GeoLite2 and its EULA, or a commercial one) is the one
   * accepting its licensing terms and owning the compliance analysis.
   * Empty: sessions carry no country and the overview hides the card.
   */
  geoipDatabasePath: string;
  dashboardTracking: DashboardTrackingConfig;
}

/** What the module configuration may set: any subset, the dashboard
 * tracking block included. */
export type DmsMarketingConfigInput = Partial<
  Omit<DmsMarketingConfig, "dashboardTracking">
> & { dashboardTracking?: Partial<DashboardTrackingConfig> };

const DEFAULT_DASHBOARD_WEBSITE_NAME = "Dashboard";
/** One dashboard route pattern: `/x`, `/x/*` or `/x/**`, no other wildcard. */
const DASHBOARD_PATH_PATTERN = /^\/[^*,\s]*(?:\/\*\*?)?$/;

const DEFAULT_CONFIG: DmsMarketingConfig = {
  trackerEnabled: true,
  rawEventsRetention: DEFAULT_RAW_EVENTS_RETENTION_MS,
  statisticsRetention: DEFAULT_STATISTICS_RETENTION_MS,
  snapshotRetention: DEFAULT_SNAPSHOT_RETENTION_MS,
  sessionIdleTimeout: DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  heatmapSampleRate: DEFAULT_HEATMAP_SAMPLE_RATIO,
  visitorHashSecret: "",
  geoipDatabasePath: "",
  dashboardTracking: {
    enabled: false,
    websiteName: DEFAULT_DASHBOARD_WEBSITE_NAME,
    excludePaths: [],
  },
};

function isDashboardPathPattern(value: unknown): value is string {
  return typeof value === "string" && DASHBOARD_PATH_PATTERN.test(value);
}

/**
 * Read field by field rather than merged: defu would append the excluded
 * paths to the defaults, and a malformed value must fall back to the default
 * instead of reaching the tag or the website record. Only `enabled: true`
 * turns it on.
 */
function parseDashboardTracking(input: unknown): DashboardTrackingConfig {
  const value =
    input && typeof input === "object"
      ? (input as Partial<Record<keyof DashboardTrackingConfig, unknown>>)
      : {};
  const name =
    typeof value.websiteName === "string" ? value.websiteName.trim() : "";
  return {
    enabled: value.enabled === true,
    websiteName:
      name.length > 0 && name.length <= MAX_NAME_LENGTH
        ? name
        : DEFAULT_DASHBOARD_WEBSITE_NAME,
    excludePaths: Array.isArray(value.excludePaths)
      ? [...new Set(value.excludePaths.filter(isDashboardPathPattern))]
      : [],
  };
}

let baseConfig: DmsMarketingConfig = DEFAULT_CONFIG;
let globalConfig: DmsMarketingConfig = DEFAULT_CONFIG;
let runtimeOverrides: Partial<DmsMarketingConfig> = {};

function mergeEffective(): void {
  globalConfig = defu(runtimeOverrides, baseConfig);
}

export function setConfig(input?: DmsMarketingConfigInput): void {
  baseConfig = {
    ...defu(input ?? {}, DEFAULT_CONFIG),
    dashboardTracking: parseDashboardTracking(input?.dashboardTracking),
  };
  mergeEffective();
}

export function applyConfigOverrides(
  overrides: Partial<DmsMarketingConfig>,
): void {
  runtimeOverrides = overrides;
  mergeEffective();
}

/** The module configuration without the Settings-page overrides. */
export function getBaseConfig(): DmsMarketingConfig {
  return baseConfig;
}

export function getConfig(): DmsMarketingConfig {
  return globalConfig;
}
