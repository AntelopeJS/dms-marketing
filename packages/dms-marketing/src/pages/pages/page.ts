import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { MARKETING_MODULE_ID } from "@/types/constants";

/**
 * Tracked pages — the inventory of a site's visited paths, with the click
 * and scroll-depth overlays of the selected one as its detail pane. Named
 * after its subject, not its rendering: per-selector views land here as
 * further overlays. A single custom component renders both panes: they share
 * a selection, a period and a URL state no composition of blocks expresses.
 */
@RegisterPage()
export class MarketingPagesPage extends PageController(
  "pages",
  {
    displayName: "$page.marketing.pages.title",
    description: "$page.marketing.pages.description",
    icon: "i-ph-cursor-click",
    module: MARKETING_MODULE_ID,
    order: 4,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static content = CustomComponent("DmsMarketingPagesView");
}
