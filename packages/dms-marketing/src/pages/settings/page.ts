import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { MARKETING_MODULE_ID } from "@/types/constants";
import { marketingSettingsForm } from "./form";

/**
 * Settings page — runtime configuration of the marketing module (tracker
 * switch, retentions, heatmap sampling). Declarative Form defined in
 * `./form`, rendered by DmsForm against /api/marketing/settings; values
 * apply without restart.
 */
@RegisterPage()
export class MarketingSettingsPage extends PageController(
  "settings",
  {
    displayName: "$page.marketing.settings.title",
    description: "$page.marketing.settings.description",
    icon: "i-ph-gear",
    module: MARKETING_MODULE_ID,
    order: 6,
  },
  DefaultLayout(),
) {
  static content = marketingSettingsForm;
}
