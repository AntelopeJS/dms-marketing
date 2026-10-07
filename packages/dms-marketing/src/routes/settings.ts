import {
  Context,
  Controller,
  Get,
  HTTPResult,
  JSONBody,
  Parameter,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assertValidation } from "@antelopejs/interface-api-util";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { MarketingSettingsModel } from "@/db";
import { marketingSettingsFormSchema } from "@/pages/settings/form";
import {
  applySettingsForm,
  collectionStatus,
  retentionGlance,
  settingsFormValues,
} from "@/services/settings";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { z } from "zod";
import { API_BASE_PATH, HTTP_BAD_REQUEST } from "@/types/constants";
import type { SettingsFormValues } from "@/types/settings";

const INVALID_SETTINGS_MESSAGE = "$page.marketing.errors.invalid_settings";

const collectionSchema = z.object({ enabled: z.boolean() });

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

  /** The Collection section: the master switch and what it currently covers. */
  @Get("collection")
  async getCollection(
    @AuthOwnerOnly() _user: User,
    @Context() context: RequestContext,
  ) {
    return collectionStatus(getRequestTenantId(context));
  }

  @Post("collection")
  async setCollection(
    @AuthOwnerOnly() _user: User,
    @Context() context: RequestContext,
    @JSONBody() body: unknown,
  ) {
    const data = assertValidation(
      body,
      // zod v3 binds `parse` to its schema in the ZodType constructor, so the
      // reference passed here is not actually unbound.
      // oxlint-disable-next-line typescript/unbound-method
      collectionSchema.parse,
      () => INVALID_SETTINGS_MESSAGE,
    );
    await applySettingsForm(GetModel(MarketingSettingsModel), {
      trackerEnabled: data.enabled,
    });
    return collectionStatus(getRequestTenantId(context));
  }

  /** One `Meter` of the "At a glance" row: a retention in days on a shared scale. */
  @Get("glance")
  async glance(
    @AuthOwnerOnly() _user: User,
    @Parameter("item", "query") item?: string,
  ) {
    const meter = retentionGlance(item);
    if (!meter) {
      throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_SETTINGS_MESSAGE);
    }
    return meter;
  }
}
