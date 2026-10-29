import type { BannerContent } from "@antelopejs/interface-dms/base/banner";
import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import type { ComposedText } from "@antelopejs/interface-dms/base/types/composed-text";
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
  HTTP_CONFLICT,
  MARKETING_MODULE_PATH,
  MAX_STATISTICS_RETENTION_DAYS,
  MS_PER_DAY,
  MS_PER_MINUTE,
  VISITOR_SECRET_BYTES,
} from "@/types/constants";
import { trailingWindow } from "./period";
import {
  countRawEventsBefore,
  countSnapshotsBefore,
  countStatisticsBefore,
} from "./prune";
import { readRollups, sumRollups } from "./rollups";
import { listTenantWebsites } from "./tenant-website";
import {
  BOOLEAN_SETTINGS,
  NUMBER_SETTINGS,
  type NumberSetting,
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
const STATISTICS_BELOW_RAW_MESSAGE =
  "$page.marketing.errors.statistics_retention_below_raw";

type SettingsDocument = Pick<MarketingSettings, SettingsConfigKey>;

let cachedSecret = "";
/** Bumped on each save, so a reload that read the row before it is dropped. */
let savedVersion = 0;

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

/**
 * Reads the row again and puts it in force: another instance may have saved
 * since. Called on a short timer and before each read of the Settings page,
 * so instances agree within seconds, without a restart.
 */
export async function reloadSettings(
  model: MarketingSettingsModel,
): Promise<void> {
  const version = savedVersion;
  const doc = await model.getSingleton();
  if (doc && version === savedVersion) {
    applyDocument(doc);
  }
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
      ? submittedNumber(setting, values[setting.id])
      : (existing?.[setting.configKey] ?? null);
  }
  return doc;
}

/**
 * Whole days and percents only. The deployment default itself is stored as
 * `null` (what "Use default" sends): the setting keeps following the config
 * instead of freezing today's default as an override.
 */
function submittedNumber(
  setting: NumberSetting,
  value: unknown,
): number | null {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }
  const rounded = Math.round(value);
  return rounded === defaultInUiUnits(setting) ? null : rounded * setting.unit;
}

/** The deployment default of a setting (module config), in its UI unit. */
export function defaultInUiUnits(setting: NumberSetting): number {
  return Math.round(getBaseConfig()[setting.configKey] / setting.unit);
}

type RetentionKey =
  | "rawEventsRetention"
  | "statisticsRetention"
  | "snapshotRetention";

function effectiveRetention(
  doc: SettingsDocument | undefined,
  key: RetentionKey,
): number {
  return doc?.[key] ?? getBaseConfig()[key];
}

/**
 * A refusal in the issue shape the DMS form reads, under the field the save
 * changed — the other one of the pair when only that one was sent.
 */
function retentionIssue(
  values: SettingsFormValues,
  changed: string,
  other: string,
  message: string,
): HTTPResult {
  const field = Object.hasOwn(values, changed) ? changed : other;
  return new HTTPResult(HTTP_BAD_REQUEST, [
    { path: [field], code: "custom", message },
  ]);
}

/**
 * Snapshots back the heatmaps drawn from raw events: one kept past the raw
 * window would outlive every click it was captured for. Sessions back the
 * funnels and A/B results read from raw events: pruned first, they would
 * leave events without their visit. Refused rather than clamped, so the form
 * says why under the field instead of saving another number.
 */
function assertCoherentRetention(
  next: SettingsDocument,
  values: SettingsFormValues,
): void {
  const raw = effectiveRetention(next, "rawEventsRetention");
  if (effectiveRetention(next, "snapshotRetention") > raw) {
    throw retentionIssue(
      values,
      "snapshotRetentionDays",
      "rawEventsRetentionDays",
      SNAPSHOT_ABOVE_RAW_MESSAGE,
    );
  }
  if (effectiveRetention(next, "statisticsRetention") < raw) {
    throw retentionIssue(
      values,
      "statisticsRetentionDays",
      "rawEventsRetentionDays",
      STATISTICS_BELOW_RAW_MESSAGE,
    );
  }
}

const RETENTION_CUTS = [
  { id: "rawEventsRetentionDays", key: "rawEventsRetention" },
  { id: "statisticsRetentionDays", key: "statisticsRetention" },
  { id: "snapshotRetentionDays", key: "snapshotRetention" },
] as const;

export type RetentionCutField = (typeof RETENTION_CUTS)[number]["id"];

/**
 * How much lowering one retention deletes, at the cutoff it would set:
 * `count` rows of the kind `what` names (a key under `retention_cut`).
 */
export type RetentionCutCounter = (
  field: RetentionCutField,
  cutoff: Date,
) => Promise<{ count: number; what: string }>;

const CUT_MESSAGE_PREFIX = "$page.marketing.errors.retention_cut.";
const CUT_CONFIRM_WINDOW_MS = 10 * MS_PER_MINUTE;

/** Cuts already warned about, by `actor:field:ms`: saved again, they pass. */
const warnedCuts = new Map<string, number>();

/**
 * Statistics are confirmed on their sessions, the figure the marketer
 * knows; on daily rollups when no session is left that old.
 */
export const countRetentionCut: RetentionCutCounter = async (field, cutoff) => {
  if (field === "rawEventsRetentionDays") {
    return { count: await countRawEventsBefore(cutoff), what: "raw_events" };
  }
  if (field === "snapshotRetentionDays") {
    return { count: await countSnapshotsBefore(cutoff), what: "snapshots" };
  }
  const { sessions, days } = await countStatisticsBefore(cutoff);
  return sessions > 0
    ? { count: sessions, what: "sessions" }
    : { count: days, what: "rollups" };
};

/**
 * A lowered retention deletes data at the next hourly prune. The first save
 * that would delete anything is answered 409, under its field, with how much
 * it deletes; the same save sent again within ten minutes goes through.
 * Kept in memory: behind several instances, a second save landing on
 * another one is warned there once more.
 */
export async function confirmRetentionCuts(
  actor: string,
  current: SettingsDocument | undefined,
  next: SettingsDocument,
  count: RetentionCutCounter = countRetentionCut,
): Promise<void> {
  const now = Date.now();
  for (const [warning, expiresAt] of warnedCuts) {
    if (expiresAt <= now) {
      warnedCuts.delete(warning);
    }
  }
  for (const cut of RETENTION_CUTS) {
    const kept = effectiveRetention(next, cut.key);
    if (kept >= effectiveRetention(current, cut.key)) {
      continue;
    }
    const warning = `${actor}:${cut.id}:${kept}`;
    if (warnedCuts.has(warning)) {
      continue;
    }
    const deleted = await count(cut.id, new Date(now - kept));
    if (deleted.count === 0) {
      continue;
    }
    warnedCuts.set(warning, now + CUT_CONFIRM_WINDOW_MS);
    throw new HTTPResult(HTTP_CONFLICT, {
      field: cut.id,
      message: `${CUT_MESSAGE_PREFIX}${deleted.what}`,
      params: { deleted: deleted.count },
    });
  }
}

/** Run between the merge and the write; throws to refuse the save. */
export type SettingsSaveGuard = (
  current: SettingsDocument | undefined,
  next: SettingsDocument,
) => Promise<void>;

/**
 * Writes the merged settings onto the singleton row. A caller that saw no row
 * goes through the fixed-key insert: a concurrent first save collides on the
 * key and this write lands on the winner's row.
 */
async function persistSettings(
  model: MarketingSettingsModel,
  next: SettingsDocument,
  existing: MarketingSettings | undefined,
): Promise<void> {
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
 *
 * Every instance booting on an empty table races on the insert; all of them end
 * up caching the one secret that was stored.
 */
export async function loadSettings(
  model: MarketingSettingsModel,
): Promise<void> {
  let doc = await model.getSingleton();
  if (!doc) {
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
  guard?: SettingsSaveGuard,
): Promise<SettingsFormValues> {
  const existing = await model.getSingleton();
  const next = buildNextSettings(values, existing);
  assertCoherentRetention(next, values);
  await guard?.(existing, next);
  await persistSettings(model, next, existing);
  savedVersion += 1;
  applyDocument(next);
  return settingsFormValues();
}

/** What the Collection section states next to the master switch. */
export interface CollectionStatus {
  enabled: boolean;
  websites: number;
  sessions: number;
}

/** Days the Collection section counts sessions over. */
const COLLECTION_WINDOW_DAYS = 30;

export async function collectionStatus(
  tenantId: string,
): Promise<CollectionStatus> {
  const websites = await listTenantWebsites(tenantId);
  const window = trailingWindow(COLLECTION_WINDOW_DAYS);
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
  valueLabel: ComposedText;
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
    valueLabel: {
      key: "$page.marketing.settings.glance.days",
      params: { count: { type: "count", value: days } },
    },
  };
}

const COLLECTION_PREFIX = "$page.marketing.settings.collection.";

/**
 * The Collection section as a stock `Banner`: whether the tracker collects,
 * what it covers, and the one action that flips it — pausing behind a
 * confirmation that says what stops, resuming in one press.
 */
export function collectionBanner(
  status: CollectionStatus,
  collectionUrl: string,
): BannerContent {
  const description: ComposedText = {
    key: `${COLLECTION_PREFIX}summary`,
    params: {
      websites: { type: "count", value: status.websites },
      sessions: { type: "number", value: status.sessions },
    },
  };
  const write = (enabled: boolean, successMessage: string) => ({
    type: "api" as const,
    url: collectionUrl,
    method: "POST" as const,
    body: { enabled },
    successMessage,
  });
  if (!status.enabled) {
    return {
      tone: "warning",
      icon: "i-ph-pause-circle",
      title: `${COLLECTION_PREFIX}paused`,
      description,
      actions: [
        {
          label: `${COLLECTION_PREFIX}resume`,
          icon: "i-ph-play",
          color: "success",
          target: write(true, `${COLLECTION_PREFIX}resumed`),
        },
      ],
    };
  }
  return {
    tone: "success",
    icon: "i-ph-broadcast",
    title: `${COLLECTION_PREFIX}collecting`,
    description,
    actions: [
      {
        label: `${COLLECTION_PREFIX}pause`,
        icon: "i-ph-pause",
        color: "error",
        variant: ButtonVariant.outline,
        target: write(false, `${COLLECTION_PREFIX}paused_toast`),
        confirm: {
          title: `${COLLECTION_PREFIX}pause_title`,
          description: `${COLLECTION_PREFIX}pause_description`,
          color: "error",
          icon: "i-ph-pause",
          confirmLabel: `${COLLECTION_PREFIX}pause_confirm`,
          impact: [
            { icon: "i-ph-code", label: `${COLLECTION_PREFIX}impact_script` },
            { icon: "i-ph-flask", label: `${COLLECTION_PREFIX}impact_tests` },
            { icon: "i-ph-clock", label: `${COLLECTION_PREFIX}impact_delay` },
          ],
        },
      },
    ],
  };
}

const PAUSED_PREFIX = "$page.marketing.websites.collection_paused.";

/**
 * The notice the Websites grid and the install guide show while the
 * module-wide collection is paused, as a stock `Banner`: no site records
 * anything until it is resumed in Settings. `null` while it collects.
 */
export function collectionPausedNotice(): BannerContent | null {
  if (getConfig().trackerEnabled) {
    return null;
  }
  return {
    tone: "warning",
    icon: "i-ph-pause-circle",
    title: `${PAUSED_PREFIX}title`,
    description: `${PAUSED_PREFIX}description`,
    actions: [
      {
        label: `${PAUSED_PREFIX}open`,
        to: `${MARKETING_MODULE_PATH}/settings`,
        variant: "outline",
        color: "neutral",
      },
    ],
  };
}
