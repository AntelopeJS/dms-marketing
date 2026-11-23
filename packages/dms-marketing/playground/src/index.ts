import "./routes/demo";
import "./routes/smoke";

import { registerDemoData } from "./demo-data";
import { registerDemoWebsiteSeed } from "./seed";

export async function construct(): Promise<void> {
  registerDemoWebsiteSeed();
  registerDemoData();
}
