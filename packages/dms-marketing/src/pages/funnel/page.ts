import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { MARKETING_MODULE_ID } from "@/types/constants";
import {
  MARKETING_PERIOD_SCOPE,
  MarketingBlock,
  CONTEXT_PAGE_LIVE,
  MarketingContext,
} from "../blocks";
import { conversionCategory } from "../module";

/**
 * One funnel's report (`?id=`): the step figure, its KPIs and where to look
 * next, or for an A/B test the verdict, the arms step by step and the code
 * that asks for a variation. The block draws its own title: the page header
 * cannot name a funnel it does not know. No `requiredQueryParams`: the DMS
 * would answer a bare 404 outside the app; the block sends a missing id back
 * to the list and names an unknown one.
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
  },
  DefaultLayout({ hideHeader: true }),
) {
  static content = MarketingContext().child(
    "report",
    MarketingBlock("FunnelReport", "funnel_report", "i-ph-funnel", {
      periodScope: MARKETING_PERIOD_SCOPE,
    }),
  );
}
