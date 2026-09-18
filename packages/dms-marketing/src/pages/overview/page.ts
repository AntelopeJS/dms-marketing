import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { MARKETING_MODULE_ID, OVERVIEW_PAGE_ID } from "@/types/constants";

/**
 * Overview page — module landing. A single custom component renders the
 * whole surface (KPI row + traffic chart + top lists). Module pages are
 * owner-only by design.
 */
@RegisterPage()
export class MarketingOverviewPage extends PageController(
  OVERVIEW_PAGE_ID,
  {
    displayName: "$page.marketing.overview.title",
    description: "$page.marketing.overview.description",
    icon: "i-ph-chart-line-up",
    module: MARKETING_MODULE_ID,
    order: 1,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static content = CustomComponent("DmsMarketingOverviewView");
}
