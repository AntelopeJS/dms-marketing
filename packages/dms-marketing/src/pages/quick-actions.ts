import {
  QuickAction,
  QuickActionCategory,
} from "@antelopejs/interface-dms/quick-actions";
import { MarketingFunnelBuilderPage } from "./funnel-builder/page";
import { MarketingInstallPage } from "./install/page";

/**
 * The module's two starting tasks in the command palette's quick actions.
 * Access follows the target pages (owner-only, like every module page).
 */
const marketingActions = QuickActionCategory("marketing", {
  displayName: "$page.marketing.category_name",
  icon: "i-ph-broadcast",
  order: 20,
});

QuickAction("add-website", {
  category: marketingActions,
  displayName: "$page.marketing.quick_actions.add_website",
  icon: "i-ph-plus",
  order: 10,
  target: { type: "navigate", page: MarketingInstallPage },
});

QuickAction("new-funnel", {
  category: marketingActions,
  displayName: "$page.marketing.quick_actions.new_funnel",
  icon: "i-ph-funnel",
  order: 20,
  target: { type: "navigate", page: MarketingFunnelBuilderPage },
});
