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
import { blockMeta, contextUrl, MarketingContext } from "../blocks";
import { conversionCategory } from "../module";

const FUNNELS_API = `${API_BASE_PATH}/funnels`;
const FUNNELS_PREFIX = "$page.marketing.funnels.";

const STATUS_TONES = {
  running: "success",
  stopped: "neutral",
  draft: "info",
} as const;

/**
 * The funnels of the context's website: a stock source table over
 * `/funnels/rows`, which reads the context the bar mirrors into the page URL.
 * A click opens the funnel's report; with no funnel yet, templates built from
 * what the site already sends take the table's place.
 */
const funnelsTable = TableView.fromSource({
  caption: `${FUNNELS_PREFIX}list_title`,
  fetchUrl: contextUrl(`${FUNNELS_API}/rows`),
  capabilities: { filter: true },
  defaultSort: { field: "conversion", desc: true },
  columns: {
    name: {
      name: `${FUNNELS_PREFIX}columns.name`,
      order: 1,
      type: new DefaultDataTypes.StringType(),
      display: new DefaultDisplays.TwoLineDisplay({ subField: "detail" }),
      sortable: true,
    },
    steps: {
      name: `${FUNNELS_PREFIX}columns.steps`,
      order: 2,
      type: new DefaultDataTypes.StringType(),
      display: new DefaultDisplays.MonoDisplay(),
      cellWrap: true,
    },
    entered: {
      name: `${FUNNELS_PREFIX}columns.entered`,
      order: 3,
      type: new DefaultDataTypes.NumberType(),
      sortable: true,
    },
    conversion: {
      name: `${FUNNELS_PREFIX}columns.conversion`,
      order: 4,
      type: new DefaultDataTypes.NumberType(),
      display: new DefaultDisplays.TwoLineDisplay({
        primaryField: "conversionText",
        subField: "comparison",
      }),
      sortable: true,
    },
    status: {
      name: `${FUNNELS_PREFIX}columns.status`,
      order: 5,
      type: new DefaultDataTypes.SelectType({
        items: (["running", "stopped", "draft"] as const).map((status) => ({
          value: status,
          label: `${FUNNELS_PREFIX}status.${status}`,
        })),
      }),
      display: new DefaultDisplays.StatusPillDisplay({ tones: STATUS_TONES }),
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
          url: `${MARKETING_MODULE_PATH}/funnel?id={_id}`,
        },
        isDefault: true,
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
      Banner({ fetchUrl: contextUrl(`${FUNNELS_API}/winner`) }).meta(
        blockMeta("funnels_winner", "i-ph-flask"),
      ),
    )
    .child(
      "list",
      funnelsTable.meta(blockMeta("funnels_table", "i-ph-funnel")).navBadge({
        count: async (ctx) => countRunningTests(getRequestTenantId(ctx)),
      }),
    );
}
