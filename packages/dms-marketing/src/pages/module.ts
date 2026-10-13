import { Category, RegisterModule } from "@antelopejs/interface-dms/page";
import { MARKETING_MODULE_ID, OVERVIEW_PAGE_ID } from "@/types/constants";
import { moduleReadout, moduleStatus } from "@/services/catalog";

interface PackageManifest {
  version: string;
}

// Read at runtime: package.json sits outside the compiled sources, one level
// above `dist` once built.
// oxlint-disable-next-line typescript/no-require-imports
const { version } = require("../../package.json") as PackageManifest;

export const marketingModule = RegisterModule({
  id: MARKETING_MODULE_ID,
  title: "$page.marketing.category_name",
  description: "$page.marketing.module_description",
  icon: "i-ph-broadcast",
  landingPage: OVERVIEW_PAGE_ID,
  version,
  catalogCategory: "$page.marketing.catalog_category",
  status: moduleStatus,
  readout: moduleReadout,
});

/**
 * The sidebar headings of the mockup. URL-transparent (`urlSlug: "/"`), so the
 * pages keep their `/modules/marketing/<page>` addresses.
 */
export const analyticsCategory = Category("analytics", {
  displayName: "$page.marketing.nav.analytics",
  category: marketingModule,
  urlSlug: "/",
  type: "label",
  order: 1,
});

export const conversionCategory = Category("conversion", {
  displayName: "$page.marketing.nav.conversion",
  category: marketingModule,
  urlSlug: "/",
  type: "label",
  order: 2,
});

export const setupCategory = Category("setup", {
  displayName: "$page.marketing.nav.setup",
  category: marketingModule,
  urlSlug: "/",
  type: "label",
  order: 3,
});
