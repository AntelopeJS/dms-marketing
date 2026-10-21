import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { MARKETING_MODULE_ID, MARKETING_MODULE_PATH } from "@/types/constants";
import {
  CONTEXT_QUERY,
  MARKETING_PERIOD_SCOPE,
  MarketingBlock,
  CONTEXT_PAGE_LIVE,
  MarketingContext,
  marketingToolbar,
} from "../blocks";
import { conversionCategory } from "../module";

/**
 * One funnel's report (`?id=`): the step figure, its KPIs and where to look
 * next, or for an A/B test the verdict, the arms step by step and the code
 * that asks for a variation. The block draws its own title: the page header
 * cannot name a funnel it does not know. Opened without an id, the page
 * sends the reader back to the list, on the same website and period; the
 * block names an unknown one.
 */
@RegisterPage()
export class MarketingFunnelPage extends PageController(
  "funnel",
  {
    displayName: "$page.marketing.funnel.title",
    description: "$page.marketing.funnel.description",
    icon: "i-ph-funnel",
    module: MARKETING_MODULE_ID,
    category: conversionCategory,
    hidden: true,
    live: CONTEXT_PAGE_LIVE,
    validation: {
      requiredQueryParams: ["id"],
      redirectTo: `${MARKETING_MODULE_PATH}/funnels?${CONTEXT_QUERY}`,
    },
  },
  DefaultLayout({ hideHeader: true }),
) {
  static toolbar = marketingToolbar();

  static content = MarketingContext().child(
    "report",
    MarketingBlock("FunnelReport", "funnel_report", "i-ph-funnel", {
      periodScope: MARKETING_PERIOD_SCOPE,
    }),
  );
}
