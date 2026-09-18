import type { DmsMarketingConfig } from "@/config";
import {
  DEFAULT_HEATMAP_SAMPLE_RATIO,
  DEFAULT_RAW_EVENTS_RETENTION_MS,
  DEFAULT_SNAPSHOT_RETENTION_MS,
  DEFAULT_STATISTICS_RETENTION_MS,
  MAX_STATISTICS_RETENTION_DAYS,
  MS_PER_DAY,
} from "./constants";

/**
 * The runtime-editable settings, declared once: the settings row, the form,
 * the endpoints and the merge helpers are all driven from this descriptor.
 * A field's id carries its UI unit (`…Days`, `…Percent`) — what crosses the
 * wire — and `unit` is the conversion to the stored canonical unit (ms, 0-1
 * rate), applied in exactly one place each way (see services/settings).
 */

const PERCENT_UNIT = 1 / 100;

const MAX_RAW_RETENTION_DAYS = 366;
const MAX_SAMPLE_PERCENT = 100;

type ConfigKeysOfType<T> = {
  [K in keyof DmsMarketingConfig]: DmsMarketingConfig[K] extends T ? K : never;
}[keyof DmsMarketingConfig];

export type NumericConfigKey = ConfigKeysOfType<number>;
export type BooleanConfigKey = ConfigKeysOfType<boolean>;

interface SettingBase {
  id: string;
  labelKey: string;
  descriptionKey: string;
}

export interface NumberSetting extends SettingBase {
  configKey: NumericConfigKey;
  unit: number;
  min: number;
  max: number;
  /** What the effective default currently is — shown while the field is empty. */
  placeholder: string;
}

export interface BooleanSetting extends SettingBase {
  configKey: BooleanConfigKey;
}

export const NUMBER_SETTINGS = [
  {
    id: "rawEventsRetentionDays",
    configKey: "rawEventsRetention",
    labelKey: "$page.marketing.settings.raw_retention",
    descriptionKey: "$page.marketing.settings.raw_retention_description",
    unit: MS_PER_DAY,
    min: 1,
    max: MAX_RAW_RETENTION_DAYS,
    placeholder: String(DEFAULT_RAW_EVENTS_RETENTION_MS / MS_PER_DAY),
  },
  {
    id: "statisticsRetentionDays",
    configKey: "statisticsRetention",
    labelKey: "$page.marketing.settings.stats_retention",
    descriptionKey: "$page.marketing.settings.stats_retention_description",
    unit: MS_PER_DAY,
    min: 1,
    // The 25-month ceiling applies to the stored rollup, so it is a bound on
    // the field, not a convention.
    max: MAX_STATISTICS_RETENTION_DAYS,
    placeholder: String(DEFAULT_STATISTICS_RETENTION_MS / MS_PER_DAY),
  },
  {
    id: "heatmapSamplePercent",
    configKey: "heatmapSampleRate",
    labelKey: "$page.marketing.settings.heatmap_sample",
    descriptionKey: "$page.marketing.settings.heatmap_sample_description",
    unit: PERCENT_UNIT,
    min: 0,
    max: MAX_SAMPLE_PERCENT,
    placeholder: String(
      Math.round(DEFAULT_HEATMAP_SAMPLE_RATIO / PERCENT_UNIT),
    ),
  },
  {
    id: "snapshotRetentionDays",
    configKey: "snapshotRetention",
    labelKey: "$page.marketing.settings.snapshot_retention",
    descriptionKey: "$page.marketing.settings.snapshot_retention_description",
    unit: MS_PER_DAY,
    min: 1,
    max: MAX_RAW_RETENTION_DAYS,
    placeholder: String(DEFAULT_SNAPSHOT_RETENTION_MS / MS_PER_DAY),
  },
] as const satisfies readonly NumberSetting[];

export const BOOLEAN_SETTINGS = [
  {
    id: "trackerEnabled",
    configKey: "trackerEnabled",
    labelKey: "$page.marketing.settings.tracker_enabled",
    descriptionKey: "$page.marketing.settings.tracker_enabled_description",
  },
] as const satisfies readonly BooleanSetting[];

export type SettingsConfigKey =
  | (typeof NUMBER_SETTINGS)[number]["configKey"]
  | (typeof BOOLEAN_SETTINGS)[number]["configKey"];

/** Settings values in UI units, keyed by field id — the wire format. */
export type SettingsFormValues = Record<string, number | boolean | null>;
