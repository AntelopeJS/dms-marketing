import { Schema, type Table } from "@antelopejs/interface-database";
import {
  CORE_SCHEMA_NAME,
  DEFAULT_TENANT_ID,
} from "@antelopejs/interface-dms/constants";
import { Hook, RegisterHook } from "@antelopejs/interface-dms/hooks";
import { DEMO_WEBSITE_ID } from "./routes/demo";

/** Must match dms-marketing's websitesTableName. */
const WEBSITES_TABLE = "marketing_websites";

interface DemoWebsiteRow {
  _id: string;
  tenantId: string;
  name: string;
  domain: string;
  extraDomains: string[];
  trackingEnabled: boolean;
  snapshotsEnabled: boolean;
  snapshotMaskText: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export function registerDemoWebsiteSeed(): void {
  RegisterHook(Hook.DATABASE_INITIALIZED, async () => {
    const table = Schema.get(CORE_SCHEMA_NAME)
      ?.instance()
      .table(WEBSITES_TABLE) as Table<DemoWebsiteRow> | undefined;
    if (!table || (await table.get(DEMO_WEBSITE_ID).run())) {
      return undefined;
    }
    const now = new Date();
    await table
      .insert({
        _id: DEMO_WEBSITE_ID,
        tenantId: DEFAULT_TENANT_ID,
        name: "Demo SaaS",
        domain: "localhost",
        extraDomains: ["127.0.0.1"],
        trackingEnabled: true,
        snapshotsEnabled: true,
        snapshotMaskText: false,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return undefined;
  });
}
