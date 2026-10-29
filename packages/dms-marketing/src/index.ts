import { MarketingSettingsModel } from "./db";
import "./data-api";
import "./routes";
import "./pages";

import { ImplementInterface } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { Hook, RegisterHook } from "@antelopejs/interface-dms/hooks";
import { AddFrontendModule } from "@antelopejs/interface-dms/page";
import cron, { type ScheduledTask } from "node-cron";
import { type DmsMarketingConfigInput, setConfig } from "./config";
import { registerMarketingHookListeners } from "./hooks";
import { frontendModule } from "./frontend-module";
import {
  loadGeoipDatabase,
  loadSettings,
  pruneAllTenants,
  reloadSettings,
  stopCollectedNotices,
} from "./services";
import { MS_PER_SECOND } from "./types/constants";

const HOURLY_CRON = "0 * * * *";
/** How stale another instance's Settings save can be here (switch included). */
const SETTINGS_RELOAD_MS = 30 * MS_PER_SECOND;

let pruneTask: ScheduledTask | null = null;
let settingsReload: NodeJS.Timeout | null = null;

/**
 * Applies the configuration, loads the GeoIP database, registers the hook
 * listeners and the database-initialized hook, implements the marketing
 * interface and adds the frontend module. `ImplementInterface` is not awaited:
 * both of its arguments are already-resolved namespaces, so the overload that
 * applies returns the pairing synchronously.
 */
export async function construct(
  config?: DmsMarketingConfigInput,
): Promise<void> {
  setConfig(config);
  await loadGeoipDatabase();
  registerMarketingHookListeners();
  RegisterHook(Hook.DATABASE_INITIALIZED, onDatabaseInitialized);

  ImplementInterface(
    await import("@antelopejs/interface-dms-marketing"),
    await import("./implementations/dms-marketing"),
  );

  await AddFrontendModule(frontendModule(config));
}

/**
 * Nothing touches the database at start: the DMS schemas every marketing
 * table lives in (dms-core / dms-tenant) are registered by the dms module's
 * own start, in unspecified order relative to this module.
 * DATABASE_INITIALIZED is the "schemas exist" signal.
 *
 * The settings are loaded before any tenant is provisioned: the DMS fires
 * TENANT_BEING_PROVISIONED for the default tenant only once this hook has
 * settled, and the content calls made there (ImportAnalytics…) need the visitor
 * secret. The settings row is shared by every instance: each reads it again on
 * a short timer, and right before pruning with the retentions it holds.
 */
async function onDatabaseInitialized(): Promise<void> {
  const settings = GetModel(MarketingSettingsModel);
  await loadSettings(settings);

  settingsReload ??= setInterval(() => {
    void reloadSettings(settings).catch(logReloadError);
  }, SETTINGS_RELOAD_MS);
  settingsReload.unref();
  pruneTask ??= cron.schedule(HOURLY_CRON, () => {
    void reloadSettings(settings)
      .then(() => pruneAllTenants(logPruneError))
      .catch(logPruneError);
  });
}

function logPruneError(err: unknown): void {
  Logging.Error("[dms-marketing] retention prune failed:", err);
}

function logReloadError(err: unknown): void {
  Logging.Error("[dms-marketing] settings reload failed:", err);
}

export function destroy(): void {}

/**
 * Stops the collected notices, the settings reload and the prune task.
 * node-cron's `stop()` returns `void | Promise<void>`, and this `stop` is
 * synchronous, so the task is told to stop and not waited on.
 */
export function stop(): void {
  stopCollectedNotices();
  if (settingsReload) {
    clearInterval(settingsReload);
    settingsReload = null;
  }
  if (pruneTask) {
    void pruneTask.stop();
    pruneTask = null;
  }
}
