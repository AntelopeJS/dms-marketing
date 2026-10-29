import {
  Context,
  Controller,
  HTTPResult,
  Post,
  type RequestContext,
} from "@antelopejs/interface-api";
import { GetModel } from "@antelopejs/interface-database-decorators";
import type { User } from "@antelopejs/interface-dms/auth/db";
import { AuthTenantMember } from "@antelopejs/interface-dms/guards";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { getConfig } from "@/config";
import { WebsitesModel } from "@/db";
import { provisionDashboardWebsite } from "@/services/dashboard-tracking";
import {
  forgetAcceptedSources,
  requestSourceHostname,
} from "@/services/origin-guard";
import { deleteSnapshots } from "@/services/snapshots";
import { invalidateWebsiteCache } from "@/services/website-cache";
import { isValidHostname, normalizeHostname } from "@/services/website-hosts";
import {
  API_BASE_PATH,
  HTTP_BAD_REQUEST,
  HTTP_NOT_FOUND,
} from "@/types/constants";

const NOT_FOUND_MESSAGE = "$page.marketing.errors.website_not_found";
const INVALID_HOSTNAME_MESSAGE = "$page.marketing.errors.invalid_hostname";

/**
 * What the dashboard's own tag asks once a user is signed in (see the
 * frontend's dashboard-tracking plugin): the website its pages report to,
 * provisioned for the caller's tenant on first use. Any member: everyone's
 * dashboard use is measured, not only the owners'. Answers 404 while
 * `dashboardTracking` is off, as if the route did not exist.
 *
 * The host is the one the browser stamps on the request (Origin, else
 * Referer, which the frontend server relays): the same header collect checks
 * the beacons against.
 */
export class DashboardTrackingController extends Controller(
  `${API_BASE_PATH}/dashboard-tracking`,
) {
  @Post("")
  async provision(
    @AuthTenantMember() _user: User,
    @Context() context: RequestContext,
  ) {
    const config = getConfig().dashboardTracking;
    if (!config.enabled) {
      throw new HTTPResult(HTTP_NOT_FOUND, NOT_FOUND_MESSAGE);
    }
    const source = requestSourceHostname(context.rawRequest.headers);
    const hostname = source ? normalizeHostname(source) : "";
    if (!isValidHostname(hostname)) {
      throw new HTTPResult(HTTP_BAD_REQUEST, INVALID_HOSTNAME_MESSAGE);
    }
    const { website, changed, snapshotsChanged } =
      await provisionDashboardWebsite(
        GetModel(WebsitesModel),
        getRequestTenantId(context),
        hostname,
        config,
      );
    if (snapshotsChanged) {
      await deleteSnapshots(website.tenantId, website._id);
    }
    if (changed) {
      invalidateWebsiteCache(website._id);
      forgetAcceptedSources(website);
    }
    return { websiteId: website._id };
  }
}
