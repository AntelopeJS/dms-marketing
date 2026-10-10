import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { MARKETING_MODULE_ID } from "@/types/constants";
import { MarketingBlock } from "../blocks";
import { setupCategory } from "../module";

/**
 * The guided install: add the website (when `?website=` names none yet),
 * paste the tag, and a connection check that turns green on the first
 * accepted pageview or names the host that was refused.
 */
@RegisterPage()
export class MarketingInstallPage extends PageController(
  "install",
  {
    displayName: "$page.marketing.install.title",
    description: "$page.marketing.install.description",
    icon: "i-ph-plug",
    module: MARKETING_MODULE_ID,
    category: setupCategory,
    hidden: true,
  },
  DefaultLayout({ hideHeader: true }),
) {
  static content = MarketingBlock(
    "InstallGuide",
    "install_guide",
    "i-ph-plug",
    {},
  );
}
