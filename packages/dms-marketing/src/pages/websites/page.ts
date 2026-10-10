import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { MarketingSessionsModel } from "@/db";
import { listTenantWebsites } from "@/services/tenant-website";
import {
  API_BASE_PATH,
  MARKETING_MODULE_ID,
  MARKETING_MODULE_PATH,
} from "@/types/constants";
import { MarketingBlock } from "../blocks";
import { setupCategory } from "../module";

/** Websites still waiting for their first pageview: the sidebar badge. */
async function countWaitingWebsites(tenantId: string): Promise<number> {
  const websites = await listTenantWebsites(tenantId);
  if (websites.length === 0) {
    return 0;
  }
  const activity = await GetModel(
    MarketingSessionsModel,
    tenantId,
  ).getLastActivityByWebsites(websites.map((website) => website._id));
  return websites.filter((website) => !activity.has(website._id)).length;
}

/**
 * Websites — one card per site with its state, volumes, accepted hosts and
 * capture options, and a settings drawer to edit, configure or delete it.
 * "Add a website" opens the install guide, which creates the site.
 */
@RegisterPage()
export class MarketingWebsitesPage extends PageController(
  "websites",
  {
    displayName: "$page.marketing.websites.title",
    description: "$page.marketing.websites.description",
    icon: "i-ph-globe",
    module: MARKETING_MODULE_ID,
    category: setupCategory,
    order: 1,
  },
  DefaultLayout({
    headerActions: [
      {
        id: "add-website",
        label: "$page.marketing.websites.create",
        icon: "i-ph-plus",
        variant: ButtonVariant.solid,
        color: "primary",
        target: { type: "page", url: `${MARKETING_MODULE_PATH}/install` },
      },
    ],
  }),
) {
  static content = MarketingBlock(
    "WebsitesGrid",
    "websites_grid",
    "i-ph-globe",
    {
      fetchUrl: `${API_BASE_PATH}/websites/summary`,
    },
  ).navBadge({
    count: async (ctx) => countWaitingWebsites(getRequestTenantId(ctx)),
  });
}
