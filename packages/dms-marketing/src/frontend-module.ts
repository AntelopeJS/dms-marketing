import path from "node:path";
import {
  type AddFrontendModuleOptions,
  MODULE_URL_PREFIX,
} from "@antelopejs/interface-dms/page";
import {
  type DashboardTrackingConfig,
  type DmsMarketingConfigInput,
  parseDashboardTracking,
} from "./config";
import { TRACKER_PUBLIC_ENDPOINTS } from "./routes/public-endpoints";
import {
  DASHBOARD_AUTH_PATHS,
  FRONTEND_CONFIG_KEY,
  FRONTEND_MODULE_NAME,
} from "./types/constants";

/**
 * The module area of the DMS — the modules page, the store and every page a
 * module registers under `MODULE_URL_PREFIX`: never counted, whatever the
 * configuration, like the sign-in pages. Dashboard tracking analyses the
 * product the owner builds, not the modules AntelopeJS or the community
 * ship; a project wanting figures on a module of its own tracks its own
 * pages instead. `/x/**` covers `/x` itself.
 */
export const DASHBOARD_MODULE_AREA_PATHS = [`${MODULE_URL_PREFIX}/**`];

/** The patterns the tag leaves uncounted: the sign-in pages and the module
 * area, then the configured ones. */
export function dashboardExcludedPaths(
  config: DashboardTrackingConfig,
): string[] {
  return [
    ...new Set([
      ...DASHBOARD_AUTH_PATHS,
      ...DASHBOARD_MODULE_AREA_PATHS,
      ...config.excludePaths,
    ]),
  ];
}

/**
 * What `AddFrontendModule` gets for the dashboard's tag: nothing while it is
 * off, so a module left at the default registers exactly as before; the
 * frontend registers its plugin only when the options are there. Read by the
 * frontend at boot: a change takes a frontend restart.
 */
export function dashboardFrontendOptions(
  config: DashboardTrackingConfig,
): Partial<AddFrontendModuleOptions> {
  if (!config.enabled) {
    return {};
  }
  return {
    configKey: FRONTEND_CONFIG_KEY,
    options: {
      dashboardTracking: { excludePaths: dashboardExcludedPaths(config) },
    },
  };
}

/**
 * This module's frontend, from its configuration alone: the backend registers
 * it with `AddFrontendModule`, and `@antelopejs/dms-frontend` calls this same
 * function (declared as `dmsFrontend` in package.json) to build and start the
 * frontend without a backend. It reads nothing but its arguments.
 */
export function frontendModule(
  config?: DmsMarketingConfigInput,
): AddFrontendModuleOptions {
  return {
    name: FRONTEND_MODULE_NAME,
    sourcePath: path.join(__dirname, "../frontend-vue"),
    renderer: { name: "vue", version: "3" },
    priority: 0,
    publicEndpoints: TRACKER_PUBLIC_ENDPOINTS,
    ...dashboardFrontendOptions(
      parseDashboardTracking(config?.dashboardTracking),
    ),
  };
}
