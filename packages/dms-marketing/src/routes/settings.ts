import { Controller, Get, JSONBody, Post } from "@antelopejs/interface-api";
import { assertValidation } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { MarketingSettingsModel } from "@/db";
import { marketingSettingsFormSchema } from "@/pages/settings/form";
import { applySettingsForm, settingsFormValues } from "@/services/settings";
import { API_BASE_PATH } from "@/types/constants";
import type { SettingsFormValues } from "@/types/settings";

const INVALID_SETTINGS_MESSAGE = "$page.marketing.errors.invalid_settings";

/**
 * Fetch/submit endpoints for the declarative Settings form. The wire format
 * is the form's field ids in UI units (days / percent); the conversion lives
 * in the settings service. Owner-only: the row is a deployment-global
 * singleton whose retention values drive cross-tenant prunes.
 */
export class MarketingSettingsController extends Controller(
  `${API_BASE_PATH}/settings`,
) {
  @Get("")
  async getSettings(@AuthOwnerOnly() _user: User) {
    return settingsFormValues();
  }

  @Post("")
  async submitSettings(
    @AuthOwnerOnly() _user: User,
    @JSONBody() body: unknown,
  ) {
    const data = assertValidation(
      body,
      // zod v3 binds `parse` to its schema in the ZodType constructor, so the
      // reference passed here is not actually unbound.
      // oxlint-disable-next-line typescript/unbound-method
      marketingSettingsFormSchema.parse,
      () => INVALID_SETTINGS_MESSAGE,
    );
    return applySettingsForm(
      GetModel(MarketingSettingsModel),
      data as SettingsFormValues,
    );
  }
}
