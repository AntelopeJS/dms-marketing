import { defu } from "defu";
import {
  DEFAULT_HEATMAP_SAMPLE_RATIO,
  DEFAULT_RAW_EVENTS_RETENTION_MS,
  DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  DEFAULT_SNAPSHOT_RETENTION_MS,
  DEFAULT_STATISTICS_RETENTION_MS,
} from "./types/constants";

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
}

const DEFAULT_CONFIG: DmsMarketingConfig = {
  trackerEnabled: true,
  rawEventsRetention: DEFAULT_RAW_EVENTS_RETENTION_MS,
  statisticsRetention: DEFAULT_STATISTICS_RETENTION_MS,
  snapshotRetention: DEFAULT_SNAPSHOT_RETENTION_MS,
  sessionIdleTimeout: DEFAULT_SESSION_IDLE_TIMEOUT_MS,
  heatmapSampleRate: DEFAULT_HEATMAP_SAMPLE_RATIO,
  visitorHashSecret: "",
  geoipDatabasePath: "",
};

let baseConfig: DmsMarketingConfig = DEFAULT_CONFIG;
let globalConfig: DmsMarketingConfig = DEFAULT_CONFIG;
let runtimeOverrides: Partial<DmsMarketingConfig> = {};

function mergeEffective(): void {
  globalConfig = defu(runtimeOverrides, baseConfig);
}

export function setConfig(input?: Partial<DmsMarketingConfig>): void {
  baseConfig = defu(input ?? {}, DEFAULT_CONFIG);
  mergeEffective();
}

export function applyConfigOverrides(
  overrides: Partial<DmsMarketingConfig>,
): void {
  runtimeOverrides = overrides;
  mergeEffective();
}

export function getConfig(): DmsMarketingConfig {
  return globalConfig;
}
