import type {
  ModuleReadoutLine,
  ModuleStatus,
} from "@antelopejs/interface-dms/page";
import { getConfig } from "@/config";

/** The module tile of the catalog: `attention` while collection is paused. */
export function moduleStatus(): ModuleStatus {
  return getConfig().trackerEnabled ? "live" : "attention";
}

/**
 * A readout line takes no params (DMS `ModuleReadoutLine.text` is a key or a
 * literal), so figures such as the 30-day sessions cannot be worded here in
 * the reader's language: the tile says the state, and where to change it.
 */
export function moduleReadout(): ModuleReadoutLine[] {
  return getConfig().trackerEnabled
    ? [{ text: "$page.marketing.catalog.collecting", tone: "success" }]
    : [
        { text: "$page.marketing.catalog.paused", tone: "warning" },
        { text: "$page.marketing.catalog.resume_hint", tone: "info" },
      ];
}
