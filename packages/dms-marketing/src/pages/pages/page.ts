import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { MARKETING_MODULE_ID } from "@/types/constants";
import {
  MARKETING_PERIOD_SCOPE,
  MarketingBlock,
  CONTEXT_PAGE_LIVE,
  MarketingContext,
} from "../blocks";
import { analyticsCategory } from "../module";

/**
 * Pages & heatmaps — the paths visitors actually loaded, with the clicks and
 * scroll depth of the selected one over its snapshot. One block renders both
 * panes: they share a selection, a period and a URL state. The website
 * picker leaves the bar for the pages pane.
 */
@RegisterPage()
export class MarketingPagesPage extends PageController(
  "pages",
  {
    displayName: "$page.marketing.pages.title",
    description: "$page.marketing.pages.description",
    icon: "i-ph-cursor-click",
    module: MARKETING_MODULE_ID,
    category: analyticsCategory,
    order: 3,
    live: CONTEXT_PAGE_LIVE,
  },
  DefaultLayout(),
) {
  static content = MarketingContext({
    waitingGuide: true,
    websitePicker: false,
  }).child(
    "explorer",
    MarketingBlock("PagesExplorer", "pages_explorer", "i-ph-cursor-click", {
      periodScope: MARKETING_PERIOD_SCOPE,
    }),
  );
}
