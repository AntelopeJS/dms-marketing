import { UAParser } from "ua-parser-js";
import type { DeviceInfo } from "@/types";

/** ua-parser-js leaves `device.type` undefined for regular desktop browsers. */
const DEFAULT_DEVICE_TYPE = "desktop";

export function parseDevice(userAgent: string | undefined): DeviceInfo {
  if (!userAgent) {
    return {};
  }
  const result = new UAParser(userAgent).getResult();
  return {
    browser: result.browser.name,
    os: result.os.name,
    deviceType: result.device.type ?? DEFAULT_DEVICE_TYPE,
  };
}
