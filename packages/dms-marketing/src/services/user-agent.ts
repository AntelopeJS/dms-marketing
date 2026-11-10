import { UAParser } from "ua-parser-js";
import type { DeviceInfo } from "@/types";
import { memoizeBounded } from "./bounded-cache";

/** ua-parser-js leaves `device.type` undefined for regular desktop browsers. */
const DEFAULT_DEVICE_TYPE = "desktop";

const parseUserAgent = memoizeBounded((userAgent): DeviceInfo => {
  const result = new UAParser(userAgent).getResult();
  return {
    browser: result.browser.name,
    os: result.os.name,
    deviceType: result.device.type ?? DEFAULT_DEVICE_TYPE,
  };
});

export function parseDevice(userAgent: string | undefined): DeviceInfo {
  return userAgent ? { ...parseUserAgent(userAgent) } : {};
}
