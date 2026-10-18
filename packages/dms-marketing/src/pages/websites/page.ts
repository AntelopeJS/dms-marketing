import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { TableView } from "@antelopejs/interface-dms/base/table-view";
import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { websitesDataAPI } from "@/data-api/websites";
import { MarketingSessionsModel } from "@/db";
import { listTenantWebsites } from "@/services/tenant-website";
import {
  MARKETING_MODULE_ID,
  WEBSITES_REALTIME_TOPIC,
} from "@/types/constants";
import { blockMeta, collectionPausedBanner } from "../blocks";
import { setupCategory } from "../module";

/** Websites still waiting for their first pageview: the sidebar badge. A
 * paused site waits for nothing. */
async function countWaitingWebsites(tenantId: string): Promise<number> {
  const websites = (await listTenantWebsites(tenantId)).filter(
    (website) => website.trackingEnabled,
  );
  if (websites.length === 0) {
    return 0;
  }
  const activity = await GetModel(
    MarketingSessionsModel,
    tenantId,
  ).getLastActivityByWebsites(websites.map((website) => website._id));
  return websites.filter((website) => !activity.has(website._id)).length;
}

const WEBSITES_PREFIX = "$page.marketing.websites.";

/**
 * The card drawn for each site, about twice the grid's default width: the
 * row stretches as many as fit to fill it, two or three side by side on a
 * desktop. `minWidth` needs a dms whose TableView takes it (dms #344); an
 * older one ignores it and keeps its default width. Held in a constant so
 * the option passes the interface types of either.
 */
const websiteCard = {
  component: CustomComponent("DmsMarketingWebsiteCard"),
  minWidth: "500px",
};

/**
 * One card per site, drawn by the module's own card component (state,
 * volumes, accepted hosts, capture options), over the websites data
 * controller: the stock toolbar searches, filters, sorts and counts them. A
 * click on a card, or its pencil, opens the site's settings in a modal;
 * `?record=<id>` opens it from a link.
 */
const websitesTable = TableView(websitesDataAPI, {
  labelKey: "name",
  displays: [{ id: "cards" }, { id: "table" }],
  defaultDisplay: "cards",
  card: websiteCard,
  defaultSort: { field: "name", desc: false },
  rowClick: "single",
  searchPlaceholder: `${WEBSITES_PREFIX}search`,
  // Writes go through /api/marketing/websites, which publish here.
  realtimeTopic: WEBSITES_REALTIME_TOPIC,
  rowActions: {
    add: false,
    edit: false,
    delete: false,
    details: false,
    duplicate: false,
    copyLink: false,
    menuLabel: `${WEBSITES_PREFIX}menu_named`,
    custom: [
      {
        id: "settings",
        label: `${WEBSITES_PREFIX}edit`,
        icon: "i-ph-pencil-simple",
        isDefault: true,
        deepLink: true,
        target: {
          type: "modal",
          size: "3xl",
          title: `${WEBSITES_PREFIX}modal.title`,
          component: CustomComponent("DmsMarketingWebsiteSettings"),
        },
      },
    ],
  },
  emptyStates: {
    firstRun: {
      title: "$page.marketing.first_run.title",
      component: CustomComponent("DmsMarketingFirstRun"),
    },
    filtered: { icon: "i-ph-globe", title: `${WEBSITES_PREFIX}no_match` },
    error: { title: `${WEBSITES_PREFIX}error` },
  },
  footer: {
    countLabel: `${WEBSITES_PREFIX}count`,
    hint: `${WEBSITES_PREFIX}privacy`,
  },
});

/**
 * Websites — the sites of the workspace as cards (or a grid), each opening
 * its settings in a modal to edit, configure or delete it. "Add a website"
 * opens a modal that creates the site, then the install guide on it.
 */
@RegisterPage()
export class MarketingWebsitesPage extends PageController(
  "websites",
  {
    displayName: "$page.marketing.websites.title",
    description: "$page.marketing.websites.description",
    icon: "i-ph-globe",
    module: MARKETING_MODULE_ID,
    category: setupCategory,
    order: 1,
  },
  DefaultLayout({
    headerActions: [
      {
        id: "add-website",
        label: "$page.marketing.websites.create",
        icon: "i-ph-plus",
        variant: ButtonVariant.solid,
        color: "primary",
        target: {
          type: "modal",
          title: "$page.marketing.websites.create_modal.title",
          description: "$page.marketing.websites.create_modal.description",
          component: CustomComponent("DmsMarketingWebsiteCreate"),
        },
      },
    ],
  }),
) {
  // The module-wide "collection paused" notice, above the cards.
  static collection = collectionPausedBanner();

  static websites = websitesTable
    .meta(blockMeta("websites_table", "i-ph-globe"))
    .navBadge({
      // In warning: a grey "Websites 1" reads as one website, not one to check.
      count: async (ctx) => ({
        count: await countWaitingWebsites(getRequestTenantId(ctx)),
        tone: "warning",
      }),
    });
}
