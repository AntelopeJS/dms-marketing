import { MarketingSettingsModel } from "./db";
import "./data-api";
import "./routes";
import "./pages";

import path from "node:path";
import { ImplementInterface } from "@antelopejs/interface-core";
import { Logging } from "@antelopejs/interface-core/logging";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { Hook, RegisterHook } from "@antelopejs/interface-dms/hooks";
import { AddFrontendModule } from "@antelopejs/interface-dms/page";
import cron, { type ScheduledTask } from "node-cron";
import { type DmsMarketingConfig, setConfig } from "./config";
import { registerMarketingHookListeners } from "./hooks";
import { loadGeoipDatabase, loadSettings, pruneAllTenants } from "./services";
import { FRONTEND_MODULE_NAME } from "./types/constants";

const HOURLY_CRON = "0 * * * *";

let pruneTask: ScheduledTask | null = null;

export async function construct(
  config?: Partial<DmsMarketingConfig>,
): Promise<void> {
  setConfig(config);
  await loadGeoipDatabase();
  registerMarketingHookListeners();
  RegisterHook(Hook.DATABASE_INITIALIZED, onDatabaseInitialized);

  // Not awaited: both arguments are already-resolved namespaces, so the
  // overload that applies returns the pairing synchronously.
  ImplementInterface(
    await import("@antelopejs/interface-dms-marketing"),
    await import("./implementations/dms-marketing"),
  );

  await AddFrontendModule({
    name: FRONTEND_MODULE_NAME,
    sourcePath: path.join(__dirname, "../frontend-vue"),
    renderer: { name: "vue", version: "3" },
    priority: 0,
  });
}

/**
 * Nothing touches the database at start: the DMS schemas every marketing
 * table lives in (dms-core / dms-tenant) are registered by the dms module's
 * own start, in unspecified order relative to this module.
 * DATABASE_INITIALIZED is the "schemas exist" signal.
 */
async function onDatabaseInitialized(): Promise<undefined> {
  await loadSettings(GetModel(MarketingSettingsModel));

  pruneTask ??= cron.schedule(HOURLY_CRON, () => {
    void pruneAllTenants(logPruneError).catch(logPruneError);
  });
  return undefined;
}

function logPruneError(err: unknown): void {
  Logging.Error("[dms-marketing] retention prune failed:", err);
}

export function destroy(): void {}

export function stop(): void {
  if (pruneTask) {
    // `stop()` is `void | Promise<void>` in node-cron; this module's own
    // `stop` is synchronous, so the task is told to stop and not waited on.
    void pruneTask.stop();
    pruneTask = null;
  }
}
