import { randomBytes } from "node:crypto";
import {
  applyConfigOverrides,
  type DmsMarketingConfig,
  getConfig,
} from "@/config";
import type { MarketingSettingsModel } from "@/db";
import type { MarketingSettings } from "@/db/tables/marketing_settings.table";
import { VISITOR_SECRET_BYTES } from "@/types/constants";
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
 * An empty numeric field is a deliberate clear: the override goes back to
 * null and the config default applies again.
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
    const submitted = values[setting.id];
    doc[setting.configKey] =
      typeof submitted === "number" && !Number.isNaN(submitted)
        ? submitted * setting.unit
        : null;
  }
  return doc;
}

async function persistSettings(
  model: MarketingSettingsModel,
  next: SettingsDocument,
  existing: MarketingSettings | undefined,
): Promise<void> {
  // Re-fetch when the caller saw no row, to guard against a concurrent
  // first-save race that would create a duplicate singleton.
  const row = existing ?? (await model.getSingleton());
  if (row) {
    Object.assign(row, next);
    await model.update(row);
    return;
  }
  await model.insert({
    ...next,
    visitorHashSecret: cachedSecret || generateSecret(),
    updatedAt: new Date(),
  } as MarketingSettings);
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
    doc = {
      ...defaultDocument(),
      visitorHashSecret: generateSecret(),
      updatedAt: new Date(),
    } as MarketingSettings;
    await model.insert(doc);
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
  await persistSettings(model, next, existing);
  applyDocument(next);
  return settingsFormValues();
}
