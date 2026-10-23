import type { FrontendPublicEndpoint } from "@antelopejs/interface-dms/page";
import { API_BASE_PATH } from "../types/constants";

const SCRIPT_METHODS = ["GET", "HEAD"];
const BEACON_METHODS = ["POST"];

/**
 * The routes a tracked site calls through the dashboard's origin, where the
 * tracker snippet points: the scripts it loads and the beacons it posts. The
 * frontend server lets them through without the site's `Origin` being the
 * dashboard's and never sends them a session; each route checks its caller.
 */
export const TRACKER_PUBLIC_ENDPOINTS: FrontendPublicEndpoint[] = [
  { path: `${API_BASE_PATH}/tracker.js`, methods: SCRIPT_METHODS },
  { path: `${API_BASE_PATH}/experiments.js`, methods: SCRIPT_METHODS },
  { path: `${API_BASE_PATH}/snapshot.js`, methods: SCRIPT_METHODS },
  { path: `${API_BASE_PATH}/collect`, methods: BEACON_METHODS },
  { path: `${API_BASE_PATH}/snapshot`, methods: BEACON_METHODS },
];
