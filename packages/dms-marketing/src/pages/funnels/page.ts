import { Banner } from "@antelopejs/interface-dms/base/banner";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { TableView } from "@antelopejs/interface-dms/base/table-view";
import { DefaultDisplays } from "@antelopejs/interface-dms/base/table-view/column-display";
import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import { GetModel } from "@antelopejs/interface-database-decorators";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { getRequestTenantId } from "@antelopejs/interface-dms/request-tenant";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { FunnelsModel } from "@/db";
import { listTenantWebsites } from "@/services/tenant-website";
import {
  API_BASE_PATH,
  MARKETING_MODULE_ID,
  MARKETING_MODULE_PATH,
} from "@/types/constants";
import {
  blockMeta,
  CONTEXT_QUERY,
  MARKETING_PERIOD_SCOPE,
  CONTEXT_PAGE_LIVE,
  MarketingContext,
  websiteUrl,
} from "../blocks";
import { conversionCategory } from "../module";

const FUNNELS_API = `${API_BASE_PATH}/funnels`;
const FUNNELS_PREFIX = "$page.marketing.funnels.";

const STATUS_TONES = {
  running: "success",
  stopped: "neutral",
  draft: "info",
} as const;

/** The table's own actions over `/api/marketing/tables/funnels`. */
const FUNNELS_TABLE_API = `${API_BASE_PATH}/tables/funnels`;
const BUILDER_URL = `${MARKETING_MODULE_PATH}/funnel-builder`;

/**
 * The funnels of the context's website: a stock source table over
 * `/funnels/rows`, on the context bar's website and period.
 * The conversion and its bar come first, so a phone shows them without
 * scrolling. A click on the row opens the report; its menu edits, duplicates
 * or deletes. With no funnel yet, templates built from the site's journeys
 * take the table's place.
 */
const funnelsTable = TableView.fromSource({
  caption: `${FUNNELS_PREFIX}list_title`,
  fetchUrl: websiteUrl(`${FUNNELS_API}/rows`),
  periodScope: MARKETING_PERIOD_SCOPE,
  capabilities: { filter: true },
  defaultSort: { field: "conversion", desc: true },
  rowClick: "single",
  columns: {
    name: {
      name: `${FUNNELS_PREFIX}columns.name`,
      order: 1,
      size: 170,
      type: new DefaultDataTypes.StringType(),
      display: new DefaultDisplays.IdentityDisplay({
        icon: "i-ph-funnel",
        subtitleField: "detail",
        iconField: "icon",
      }),
      sortable: true,
    },
    conversion: {
      name: `${FUNNELS_PREFIX}columns.conversion`,
      order: 2,
      size: 105,
      type: new DefaultDataTypes.NumberType(),
      display: new DefaultDisplays.TwoLineDisplay({
        primaryField: "conversionText",
        subField: "comparison",
      }),
      sortable: true,
    },
    entered: {
      name: `${FUNNELS_PREFIX}columns.completed_of_entered`,
      order: 3,
      size: 190,
      type: new DefaultDataTypes.NumberType(),
      display: new DefaultDisplays.ProgressDisplay({
        doneField: "completed",
        totalField: "entered",
      }),
      sortable: true,
    },
    status: {
      name: `${FUNNELS_PREFIX}columns.status`,
      order: 4,
      size: 110,
      type: new DefaultDataTypes.SelectType({
        items: (["running", "stopped", "draft"] as const).map((status) => ({
          value: status,
          label: `${FUNNELS_PREFIX}status.${status}`,
        })),
      }),
      display: new DefaultDisplays.StatusPillDisplay({
        tones: STATUS_TONES,
        liveValues: ["running"],
      }),
    },
    steps: {
      name: `${FUNNELS_PREFIX}columns.steps`,
      order: 5,
      size: 320,
      type: new DefaultDataTypes.StringType(),
      display: new DefaultDisplays.PillsDisplay(),
    },
    kind: {
      name: `${FUNNELS_PREFIX}columns.kind`,
      order: 6,
      isVisible: false,
      filterable: true,
      type: new DefaultDataTypes.SelectType({
        items: [
          { value: "funnel", label: `${FUNNELS_PREFIX}tabs.funnels` },
          { value: "ab", label: `${FUNNELS_PREFIX}tabs.ab` },
        ],
      }),
    },
  },
  tabs: [
    { id: "all", label: `${FUNNELS_PREFIX}tabs.all` },
    {
      id: "funnels",
      label: `${FUNNELS_PREFIX}tabs.funnels`,
      icon: "i-ph-funnel",
      filter: { accessorKey: "kind", mode: "is", value: "funnel" },
    },
    {
      id: "ab",
      label: `${FUNNELS_PREFIX}tabs.ab`,
      icon: "i-ph-flask",
      filter: { accessorKey: "kind", mode: "is", value: "ab" },
    },
  ],
  rowActions: {
    custom: [
      {
        label: `${FUNNELS_PREFIX}open`,
        icon: "i-ph-arrow-right",
        target: {
          type: "page",
          url: `${MARKETING_MODULE_PATH}/funnel?id={_id}&${CONTEXT_QUERY}`,
        },
        isDefault: true,
      },
      {
        label: `${FUNNELS_PREFIX}actions.edit`,
        icon: "i-ph-pencil-simple",
        target: {
          type: "page",
          url: `${BUILDER_URL}?id={_id}&${CONTEXT_QUERY}`,
        },
      },
      {
        label: `${FUNNELS_PREFIX}actions.duplicate`,
        icon: "i-ph-copy",
        target: {
          type: "page",
          url: `${BUILDER_URL}?copy={_id}&${CONTEXT_QUERY}`,
        },
      },
      {
        label: `${FUNNELS_PREFIX}actions.delete`,
        icon: "i-ph-trash",
        color: "error",
        target: {
          type: "api",
          method: "DELETE",
          url: `${FUNNELS_TABLE_API}/delete?id={_id}`,
          successMessage: "$page.marketing.funnel.delete.done",
        },
        confirm: { from: `${FUNNELS_API}/{id}/delete-confirmation` },
      },
    ],
  },
  emptyStates: {
    firstRun: {
      title: `${FUNNELS_PREFIX}empty.title_plain`,
      component: CustomComponent("DmsMarketingFunnelTemplates"),
    },
    filtered: { icon: "i-ph-funnel", title: `${FUNNELS_PREFIX}no_match` },
  },
  footer: {
    countLabel: `${FUNNELS_PREFIX}count`,
    hint: `${FUNNELS_PREFIX}note`,
  },
});

/** Running A/B tests of the tenant: the sidebar badge of the page. */
async function countRunningTests(tenantId: string): Promise<number> {
  const websites = await listTenantWebsites(tenantId);
  const model = GetModel(FunnelsModel, tenantId);
  const running = await Promise.all(
    websites.map((website) => model.listRunning(website._id)),
  );
  return running.reduce((sum, funnels) => sum + funnels.length, 0);
}

/**
 * Funnels & A/B tests — every funnel of the selected website with its
 * conversion over the period, the A/B tests with their status, and the test
 * that is ready to decide. Each row opens the funnel's own page.
 */
@RegisterPage()
export class MarketingFunnelsPage extends PageController(
  "funnels",
  {
    displayName: "$page.marketing.funnels.title",
    description: "$page.marketing.funnels.description",
    icon: "i-ph-funnel",
    module: MARKETING_MODULE_ID,
    category: conversionCategory,
    order: 1,
    live: CONTEXT_PAGE_LIVE,
  },
  DefaultLayout({
    headerActions: [
      {
        id: "new-funnel",
        label: "$page.marketing.funnels.new",
        icon: "i-ph-plus",
        variant: ButtonVariant.solid,
        color: "primary",
        target: {
          type: "page",
          url: `${MARKETING_MODULE_PATH}/funnel-builder`,
        },
      },
    ],
  }),
) {
  static content = MarketingContext()
    .child(
      "winner",
      Banner({
        fetchUrl: websiteUrl(`${FUNNELS_API}/winner`),
        periodScope: MARKETING_PERIOD_SCOPE,
      }).meta(blockMeta("funnels_winner", "i-ph-flask")),
    )
    .child(
      "list",
      funnelsTable.meta(blockMeta("funnels_table", "i-ph-funnel")).navBadge({
        // In the primary tone: tests live, not funnels to count.
        count: async (ctx) => ({
          count: await countRunningTests(getRequestTenantId(ctx)),
          tone: "primary",
        }),
      }),
    );
}
