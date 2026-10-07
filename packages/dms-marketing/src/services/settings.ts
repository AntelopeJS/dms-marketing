import { randomBytes } from "node:crypto";
import {
  applyConfigOverrides,
  type DmsMarketingConfig,
  getBaseConfig,
  getConfig,
} from "@/config";
import { HTTPResult } from "@antelopejs/interface-api";
import type { MarketingSettingsModel } from "@/db";
import type { MarketingSettings } from "@/db/tables/marketing_settings.table";
import {
  HTTP_BAD_REQUEST,
  MAX_STATISTICS_RETENTION_DAYS,
  MS_PER_DAY,
  VISITOR_SECRET_BYTES,
} from "@/types/constants";
import { resolveQueryWindow } from "./period";
import { readRollups, sumRollups } from "./rollups";
import { listTenantWebsites } from "./tenant-website";
import {
  BOOLEAN_SETTINGS,
  NUMBER_SETTINGS,
  type SettingsConfigKey,
  type SettingsFormValues,
} from "@/types/settings";

/**
 * Runtime settings service: the singleton document is pushed into the config
 * layer on load and on every save, so every `getConfig()` call site picks up
 * the Settings-page values. Also owns the generated visitor-hash secret.
 * Which settings exist and their units come from `types/settings`; this file
 * owns the merge rules and the unit conversion, once each way.
 */

const SNAPSHOT_ABOVE_RAW_MESSAGE =
  "$page.marketing.errors.snapshot_retention_above_raw";

type SettingsDocument = Pick<MarketingSettings, SettingsConfigKey>;

let cachedSecret = "";

export function getVisitorHashSecret(): string {
  const configured = getConfig().visitorHashSecret;
  return configured !== "" ? configured : cachedSecret;
}

function generateSecret(): string {
  return randomBytes(VISITOR_SECRET_BYTES).toString("hex");
}

/**
 * A numeric null is the absence of an override: it must fall through to the
 * module config, never reach it as a zero.
 */
function overridesFrom(doc: SettingsDocument): Partial<DmsMarketingConfig> {
  const overrides: Partial<DmsMarketingConfig> = {};
  for (const setting of BOOLEAN_SETTINGS) {
    overrides[setting.configKey] = doc[setting.configKey];
  }
  for (const setting of NUMBER_SETTINGS) {
    const stored = doc[setting.configKey];
    if (stored != null) {
      overrides[setting.configKey] = stored;
    }
  }
  return overrides;
}

function applyDocument(doc: SettingsDocument | undefined): void {
  applyConfigOverrides(doc ? overridesFrom(doc) : {});
}

function defaultDocument(): SettingsDocument {
  const config = getConfig();
  const doc = {} as SettingsDocument;
  for (const setting of BOOLEAN_SETTINGS) {
    doc[setting.configKey] = config[setting.configKey];
  }
  for (const setting of NUMBER_SETTINGS) {
    doc[setting.configKey] = null;
  }
  return doc;
}

/**
 * The settings in force, in UI units (days / percent). An unset numeric
 * override reads as the effective default, never as an empty field.
 */
export function settingsFormValues(): SettingsFormValues {
  const config = getConfig();
  const values: SettingsFormValues = {};
  for (const setting of BOOLEAN_SETTINGS) {
    values[setting.id] = config[setting.configKey];
  }
  for (const setting of NUMBER_SETTINGS) {
    values[setting.id] = Math.max(
      setting.min,
      Math.round(config[setting.configKey] / setting.unit),
    );
  }
  return values;
}

/**
 * The body is partial (a form sends the fields the user changed): a key left
 * out keeps its stored value, and an emptied numeric field arrives as `null`,
 * a deliberate clear that puts the config default back in force.
 */
function buildNextSettings(
  values: SettingsFormValues,
  existing: MarketingSettings | undefined,
): SettingsDocument {
  const doc = {} as SettingsDocument;
  const config = getConfig();
  for (const setting of BOOLEAN_SETTINGS) {
    const submitted = values[setting.id];
    doc[setting.configKey] =
      typeof submitted === "boolean"
        ? submitted
        : (existing?.[setting.configKey] ?? config[setting.configKey]);
  }
  for (const setting of NUMBER_SETTINGS) {
    doc[setting.configKey] = Object.hasOwn(values, setting.id)
      ? submittedNumber(values[setting.id], setting.unit)
      : (existing?.[setting.configKey] ?? null);
  }
  return doc;
}

function submittedNumber(value: unknown, unit: number): number | null {
  return typeof value === "number" && !Number.isNaN(value)
    ? value * unit
    : null;
}

/**
 * Snapshots back the heatmaps drawn from raw events: one kept past the raw
 * window would outlive every click it was captured for. Refused rather than
 * clamped, so the form says why instead of saving another number.
 */
function assertCoherentRetention(next: SettingsDocument): void {
  const base = getBaseConfig();
  const raw = next.rawEventsRetention ?? base.rawEventsRetention;
  const snapshots = next.snapshotRetention ?? base.snapshotRetention;
  if (snapshots > raw) {
    throw new HTTPResult(HTTP_BAD_REQUEST, SNAPSHOT_ABOVE_RAW_MESSAGE);
  }
}

async function persistSettings(
  model: MarketingSettingsModel,
  next: SettingsDocument,
  existing: MarketingSettings | undefined,
): Promise<void> {
  // A caller that saw no row goes through the fixed-key insert: a concurrent
  // first save collides on the key and this write lands on the winner's row.
  const row =
    existing ??
    (await model.getSingleton()) ??
    (await createSingleton(model, next, cachedSecret || generateSecret()));
  Object.assign(row, next);
  await model.update(row);
}

/** The row in force after the insert — ours, or the instance's that won. */
async function createSingleton(
  model: MarketingSettingsModel,
  doc: SettingsDocument,
  visitorHashSecret: string,
): Promise<MarketingSettings> {
  const row = await model.insertSingleton({
    ...doc,
    visitorHashSecret,
    updatedAt: new Date(),
  } as MarketingSettings);
  cachedSecret = row.visitorHashSecret;
  return row;
}

/**
 * Creates the singleton (with a fresh secret) on first run so visitor ids
 * stay stable across restarts without an explicit config secret.
 */
export async function loadSettings(
  model: MarketingSettingsModel,
): Promise<void> {
  let doc = await model.getSingleton();
  if (!doc) {
    // Every instance booting on an empty table races here; all of them end
    // up caching the one secret that was stored.
    doc = await createSingleton(model, defaultDocument(), generateSecret());
  } else if (!doc.visitorHashSecret) {
    doc.visitorHashSecret = generateSecret();
    await model.update(doc);
  }
  cachedSecret = doc.visitorHashSecret;
  applyDocument(doc);
}

export async function applySettingsForm(
  model: MarketingSettingsModel,
  values: SettingsFormValues,
): Promise<SettingsFormValues> {
  const existing = await model.getSingleton();
  const next = buildNextSettings(values, existing);
  assertCoherentRetention(next);
  await persistSettings(model, next, existing);
  applyDocument(next);
  return settingsFormValues();
}

/** What the Collection section states next to the master switch. */
export interface CollectionStatus {
  enabled: boolean;
  websites: number;
  sessions: number;
}

const COLLECTION_WINDOW = "30d";

export async function collectionStatus(
  tenantId: string,
): Promise<CollectionStatus> {
  const websites = await listTenantWebsites(tenantId);
  const window = resolveQueryWindow({ period: COLLECTION_WINDOW });
  const rows = await Promise.all(
    websites.map((website) => readRollups(website, window)),
  );
  return {
    enabled: getConfig().trackerEnabled,
    websites: websites.length,
    sessions: rows.reduce((sum, days) => sum + sumRollups(days).sessions, 0),
  };
}

/** The `Meter` payload of one retention, on the statistics ceiling's scale. */
export interface RetentionMeter {
  value: number;
  max: number;
  valueLabel: string;
}

const GLANCE_ITEMS = {
  raw: "rawEventsRetention",
  statistics: "statisticsRetention",
  snapshots: "snapshotRetention",
} as const;

export function retentionGlance(item: unknown): RetentionMeter | null {
  if (typeof item !== "string" || !Object.hasOwn(GLANCE_ITEMS, item)) {
    return null;
  }
  const key = GLANCE_ITEMS[item as keyof typeof GLANCE_ITEMS];
  const days = Math.round(getConfig()[key] / MS_PER_DAY);
  return {
    value: days,
    max: MAX_STATISTICS_RETENTION_DAYS,
    valueLabel: `${days} d`,
  };
}
