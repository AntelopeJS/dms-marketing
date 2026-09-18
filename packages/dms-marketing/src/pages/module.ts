import { RegisterModule } from "@antelopejs/interface-dms/page";
import { MARKETING_MODULE_ID, OVERVIEW_PAGE_ID } from "@/types/constants";

export const marketingModule = RegisterModule({
  id: MARKETING_MODULE_ID,
  title: "$page.marketing.category_name",
  description: "$page.marketing.overview.description",
  icon: "i-ph-chart-line-up",
  landingPage: OVERVIEW_PAGE_ID,
});
