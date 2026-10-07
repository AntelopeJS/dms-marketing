import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { FunnelsModel } from "@/db";
import { listTenantWebsites } from "@/services/tenant-website";
import {
  API_BASE_PATH,
  MARKETING_MODULE_ID,
  MARKETING_MODULE_PATH,
} from "@/types/constants";
import {
  MARKETING_PERIOD_SCOPE,
  MarketingBlock,
  MarketingContext,
} from "../blocks";
import { conversionCategory } from "../module";

/** Running A/B tests of the tenant: the sidebar badge of the page. */
async function countRunningTests(tenantId: string): Promise<number> {
  const websites = await listTenantWebsites(tenantId);
  const model = GetModel(FunnelsModel, tenantId);
  const running = await Promise.all(
    websites.map((website) => model.listRunning(website._id)),
  );
  return running.reduce((sum, funnels) => sum + funnels.length, 0);
}

/**
 * Funnels & A/B tests — every funnel of the selected website with its
 * conversion over the period, the A/B tests with their status, and the test
 * that is ready to decide. Each row opens the funnel's own page.
 */
@RegisterPage()
export class MarketingFunnelsPage extends PageController(
  "funnels",
  {
    displayName: "$page.marketing.funnels.title",
    description: "$page.marketing.funnels.description",
    icon: "i-ph-funnel",
    module: MARKETING_MODULE_ID,
    category: conversionCategory,
    order: 1,
  },
  DefaultLayout({
    headerActions: [
      {
        id: "new-funnel",
        label: "$page.marketing.funnels.new",
        icon: "i-ph-plus",
        variant: ButtonVariant.solid,
        color: "primary",
        target: {
          type: "page",
          url: `${MARKETING_MODULE_PATH}/funnel-builder`,
        },
      },
    ],
  }),
) {
  static content = MarketingContext().child(
    "list",
    MarketingBlock("FunnelsTable", "funnels_table", "i-ph-funnel", {
      fetchUrl: `${API_BASE_PATH}/funnels/summary`,
      periodScope: MARKETING_PERIOD_SCOPE,
    }).navBadge({
      count: async (ctx) => countRunningTests(getRequestTenantId(ctx)),
    }),
  );
}
