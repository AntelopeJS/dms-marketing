import {
  Field,
  RegisterTable,
  Table,
  UpdateTime,
} from "@antelopejs/interface-database-decorators";
import { TENANT_SCHEMA_NAME } from "@antelopejs/interface-dms/constants";

export const marketingPreferencesTableName = "marketing_preferences";

/**
 * What one member last looked at, keyed by user id in the per-tenant schema:
 * the website every analytics page reads when no `website` parameter names
 * one. Kept server-side because the blocks fetch from the API origin, which
 * need not share cookies with the frontend.
 */
@RegisterTable(marketingPreferencesTableName, TENANT_SCHEMA_NAME)
export class MarketingPreferences extends Table {
  @Field("string")
  declare websiteId: string;

  @UpdateTime()
  @Field("date")
  declare updatedAt: Date;
}
