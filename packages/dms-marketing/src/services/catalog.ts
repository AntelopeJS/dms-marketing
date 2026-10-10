import type {
  ModuleReadoutLine,
  ModuleStatus,
} from "@antelopejs/interface-dms/page";
import { getConfig } from "@/config";

/** The module tile of the catalog: `attention` while collection is paused. */
export function moduleStatus(): ModuleStatus {
  return getConfig().trackerEnabled ? "live" : "attention";
}

export function moduleReadout(): ModuleReadoutLine[] {
  return getConfig().trackerEnabled
    ? [{ text: "$page.marketing.catalog.collecting", tone: "success" }]
    : [{ text: "$page.marketing.catalog.paused", tone: "warning" }];
}
