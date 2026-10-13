/**
 * Playground host module — the same shape as dms-api's playground: it exists so
 * the project has a `local` root module, and hosts the browser test fixtures
 * for dms-marketing.
 */
import "./routes/demo";
import "./routes/smoke";

import { registerDemoData } from "./demo-data";
import { registerDemoWebsiteSeed } from "./seed";

export async function construct(): Promise<void> {
  registerDemoWebsiteSeed();
  registerDemoData();
}
