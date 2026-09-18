import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { MARKETING_MODULE_ID } from "@/types/constants";

/**
 * Acquisition page — the channel split and the UTM campaign table
 * (source × medium × campaign), right after the overview because "where do
 * sessions come from" is the first question the overview raises. A single
 * custom component renders the whole surface.
 */
@RegisterPage()
export class MarketingCampaignsPage extends PageController(
  "campaigns",
  {
    displayName: "$page.marketing.campaigns.title",
    description: "$page.marketing.campaigns.description",
    icon: "i-ph-megaphone",
    module: MARKETING_MODULE_ID,
    order: 2,
  },
  DefaultLayout({ fullWidth: true }),
) {
  static content = CustomComponent("DmsMarketingCampaignsView");
}
