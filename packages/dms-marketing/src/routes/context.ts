import {
  Context,
  Controller,
  Get,
  JSONBody,
  Put,
  type RequestContext,
} from "@antelopejs/interface-api";
import { assertValidation } from "@antelopejs/interface-api-util";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { AuthTenantMember } from "@antelopejs/interface-dms/guards";
import { z } from "zod";
import { loadMarketingContext, selectContextWebsite } from "@/services/context";
import { API_BASE_PATH, MAX_WEBSITE_ID_LENGTH } from "@/types/constants";
import type { JsonBody } from "@/types/json";

const INVALID_CONTEXT_MESSAGE = "$page.marketing.errors.invalid_website";

const contextSelectionSchema = z.object({
  website: z.string().min(1).max(MAX_WEBSITE_ID_LENGTH),
});

/**
 * The context bar's two calls: the tenant's websites with their live state and
 * the caller's saved website, and its change. The saved website is only the
 * default of a page opened without `?website`: the bar saves it on a pick,
 * the blocks read the website the page URL names.
 */
export class MarketingContextController extends Controller(
  `${API_BASE_PATH}/context`,
) {
  @Get("")
  async get(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
  ) {
    return loadMarketingContext(context, user);
  }

  @Put("")
  async select(
    @AuthTenantMember() user: User,
    @Context() context: RequestContext,
    @JSONBody() body: JsonBody,
  ) {
    const data = assertValidation(
      body,
      (value) => contextSelectionSchema.parse(value),
      () => INVALID_CONTEXT_MESSAGE,
    );
    await selectContextWebsite(context, user, data.website);
    return loadMarketingContext(context, user);
  }
}
