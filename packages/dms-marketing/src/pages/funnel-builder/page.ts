import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { MARKETING_MODULE_ID } from "@/types/constants";
import { MarketingBlock } from "../blocks";
import { conversionCategory } from "../module";

/**
 * The funnel builder, for a new funnel or the one `?id=` names: steps picked
 * from the site's own pages and events, a live preview, and the optional A/B
 * split. Writes through `funnelsDataAPI`, which owns the validation.
 */
@RegisterPage()
export class MarketingFunnelBuilderPage extends PageController(
  "funnel-builder",
  {
    displayName: "$page.marketing.builder.page_title",
    description: "$page.marketing.builder.description",
    icon: "i-ph-funnel",
    module: MARKETING_MODULE_ID,
    category: conversionCategory,
    hidden: true,
  },
  DefaultLayout({ hideHeader: true }),
) {
  static content = MarketingBlock(
    "FunnelBuilder",
    "funnel_builder",
    "i-ph-pencil-simple",
    {},
  );
}
