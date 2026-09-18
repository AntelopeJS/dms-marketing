import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { MARKETING_MODULE_ID } from "@/types/constants";

/**
 * Funnels page — ordered conversion journeys (URL and custom-event steps),
 * plain or split into A/B arms, laid out like the tracked-pages page: the
 * definitions list on the left, the figure of the selected one as its detail
 * pane. A single custom component renders both panes plus the CRUD drawers:
 * they share a selection, a period and a URL state no composition of blocks
 * expresses. Definitions CRUD stays on funnelsDataAPI, registered on its own.
 */
@RegisterPage()
export class MarketingFunnelsPage extends PageController(
  "funnels",
  {
    displayName: "$page.marketing.funnels.title",
    description: "$page.marketing.funnels.description",
    icon: "i-ph-funnel",
    module: MARKETING_MODULE_ID,
    order: 3,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static content = CustomComponent("DmsMarketingFunnelsView");
}
