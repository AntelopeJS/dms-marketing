import {
  Context,
  Controller,
  Get,
  HTTPResult,
  Parameter,
  Post,
  Put,
  RawBody,
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
  collectionBanner,
  collectionStatus,
  confirmRetentionCuts,
  reloadSettings,
  retentionGlance,
  settingsFormValues,
} from "@/services/settings";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { z } from "zod";
import { API_BASE_PATH, HTTP_BAD_REQUEST } from "@/types/constants";
import type { SettingsFormValues } from "@/types/settings";

const INVALID_SETTINGS_MESSAGE = "$page.marketing.errors.invalid_settings";

const collectionSchema = z.object({ enabled: z.boolean() }).strict();

// A key the form does not know is refused rather than silently dropped.
const settingsSchema = marketingSettingsFormSchema.strict();

/** A body that is not JSON is the caller's mistake: 400, not a 500. */
function parseJsonBody(body: Buffer): unknown {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_SETTINGS_MESSAGE);
  }
}

/**
 * Fetch/submit endpoints for the declarative Settings form. The wire format
 * is the form's field ids in UI units (days / percent); the conversion lives
 * in the settings service. Owner-only: the row is a deployment-global
 * singleton whose retention values drive cross-tenant prunes. Every read
 * loads the row again, so the page shows what another instance saved.
 */
export class MarketingSettingsController extends Controller(
  `${API_BASE_PATH}/settings`,
) {
  @Get("")
  async getSettings(@AuthOwnerOnly() _user: User) {
    await reloadSettings(GetModel(MarketingSettingsModel));
    return settingsFormValues();
  }

  /**
   * PUT: the form sends only the fields the user changed. Validation issues
   * go back as zod issues (the default of `assertValidation`), which the
   * form shows under their field. A lowered retention that deletes data is
   * confirmed by saving it twice (see `confirmRetentionCuts`).
   */
  @Put("")
  async submitSettings(@AuthOwnerOnly() user: User, @RawBody() body: Buffer) {
    // zod v3 binds `parse` to its schema in the ZodType constructor, so the
    // reference passed here is not actually unbound.
    // oxlint-disable-next-line typescript/unbound-method
    const data = assertValidation(parseJsonBody(body), settingsSchema.parse);
    return applySettingsForm(
      GetModel(MarketingSettingsModel),
      data as SettingsFormValues,
      (current, next) => confirmRetentionCuts(user._id, current, next),
    );
  }

  /** The Collection section: the master switch and what it currently covers. */
  @Get("collection")
  async getCollection(
    @AuthOwnerOnly() _user: User,
    @Context() context: RequestContext,
  ) {
    await reloadSettings(GetModel(MarketingSettingsModel));
    return collectionStatus(getRequestTenantId(context));
  }

  /** The Collection section as a stock `Banner`: state, coverage, pause or resume. */
  @Get("collection/banner")
  async getCollectionBanner(
    @AuthOwnerOnly() _user: User,
    @Context() context: RequestContext,
  ) {
    await reloadSettings(GetModel(MarketingSettingsModel));
    return collectionBanner(
      await collectionStatus(getRequestTenantId(context)),
      `${API_BASE_PATH}/settings/collection`,
    );
  }

  @Post("collection")
  async setCollection(
    @AuthOwnerOnly() _user: User,
    @Context() context: RequestContext,
    @RawBody() body: Buffer,
  ) {
    const data = assertValidation(
      parseJsonBody(body),
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
    await reloadSettings(GetModel(MarketingSettingsModel));
    const meter = retentionGlance(item);
    if (!meter) {
      throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_SETTINGS_MESSAGE);
    }
    return meter;
  }
}
