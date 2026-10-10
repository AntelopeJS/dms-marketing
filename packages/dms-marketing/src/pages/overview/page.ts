import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import { ChartArea } from "@antelopejs/interface-dms/base/chart";
import { ChartCard } from "@antelopejs/interface-dms/base/chart-card";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { KpiCard } from "@antelopejs/interface-dms/base/kpi-card";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { StatGroup } from "@antelopejs/interface-dms/base/stat-group";
import { TopListCard } from "@antelopejs/interface-dms/base/top-list-card";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import {
  MARKETING_MODULE_ID,
  MARKETING_MODULE_PATH,
  OVERVIEW_PAGE_ID,
} from "@/types/constants";
import {
  BLOCKS_API,
  blockMeta,
  MARKETING_PERIOD_SCOPE,
  MarketingBlock,
  MarketingContext,
} from "../blocks";
import { analyticsCategory } from "../module";

const KPI_PREFIX = "$page.marketing.overview.kpis.";
const COMPARE_LABEL = "$page.marketing.context.vs_previous";

function volumeKpi(metric: string, icon: string) {
  return KpiCard({
    title: `${KPI_PREFIX}${metric}`,
    icon,
    variant: "stat",
    valueFormat: "number",
    showSparkline: true,
    compareLabel: COMPARE_LABEL,
    fetchUrl: `${BLOCKS_API}/kpi?metric=${metric}`,
    periodScope: MARKETING_PERIOD_SCOPE,
  }).meta(blockMeta(`kpi_${metric.replaceAll("-", "_")}`, icon));
}

function topListTabs(group: string, icon: string, footer?: string) {
  return MarketingBlock("TopListTabs", `tops_${group}`, icon, {
    fetchUrl: `${BLOCKS_API}/tops?group=${group}`,
    periodScope: MARKETING_PERIOD_SCOPE,
    eyebrow: `$page.marketing.overview.groups.${group}.title`,
    valueLabel: `$page.marketing.overview.groups.${group}.value`,
    note: `$page.marketing.overview.groups.${group}.note`,
    footerLabel: footer
      ? `$page.marketing.overview.groups.${group}.view_all`
      : undefined,
    footerTo: footer,
  });
}

/**
 * Overview — the module landing: volume KPIs with their change, a session
 * quality strip, the traffic curve against the previous period, devices, and
 * the four top lists whose rows lead to the surface that owns them.
 */
@RegisterPage()
export class MarketingOverviewPage extends PageController(
  OVERVIEW_PAGE_ID,
  {
    displayName: "$page.marketing.overview.title",
    description: "$page.marketing.overview.description",
    icon: "i-ph-chart-line-up",
    module: MARKETING_MODULE_ID,
    category: analyticsCategory,
    order: 1,
  },
  DefaultLayout({
    headerActions: [
      {
        id: "view-funnels",
        label: "$page.marketing.overview.view_funnels",
        icon: "i-ph-funnel",
        variant: ButtonVariant.solid,
        color: "primary",
        target: { type: "page", url: `${MARKETING_MODULE_PATH}/funnels` },
      },
    ],
  }),
) {
  static content = MarketingContext()
    .child(
      "kpis",
      Grid({ minColumnWidth: "200px" })
        .child(
          "row",
          GridRow()
            .child("pageviews", volumeKpi("pageviews", "i-ph-eye"))
            .child("sessions", volumeKpi("sessions", "i-ph-users"))
            .child("new-visitors", volumeKpi("new-visitors", "i-ph-user-plus"))
            .child("custom-events", volumeKpi("custom-events", "i-ph-sparkle")),
        )
        .meta(blockMeta("kpis", "i-ph-squares-four")),
    )
    .child(
      "quality",
      StatGroup({
        fetchUrl: `${BLOCKS_API}/quality`,
        periodScope: MARKETING_PERIOD_SCOPE,
        label: "$page.marketing.blocks.quality.name",
        skeletonCount: 3,
      }).meta(blockMeta("quality", "i-ph-gauge")),
    )
    .child(
      "traffic",
      Grid({ minColumnWidth: "320px" })
        .child(
          "row",
          GridRow()
            .child(
              "chart",
              ChartCard({
                title: "$page.marketing.overview.traffic.title",
                icon: "i-ph-chart-line",
                fetchUrl: `${BLOCKS_API}/traffic?metric=sessions`,
                periodScope: MARKETING_PERIOD_SCOPE,
                valueFormat: "number",
                primaryLabel: "$page.marketing.overview.traffic.this_period",
                comparisonLabel:
                  "$page.marketing.overview.traffic.previous_period",
                chart: ChartArea({
                  smooth: true,
                  xaxisType: "datetime",
                  comparisonStyle: "dashed",
                  height: "260px",
                }),
              }).meta(blockMeta("traffic", "i-ph-chart-line")),
              { colSpan: 2 },
            )
            .child(
              "devices",
              TopListCard({
                title: "$page.marketing.overview.devices.title",
                fetchUrl: `${BLOCKS_API}/devices`,
                periodScope: MARKETING_PERIOD_SCOPE,
                valueFormat: "number",
                emptyLabel: "$page.marketing.overview.devices.empty",
                skeletonCount: 3,
              }).meta(blockMeta("devices", "i-ph-devices")),
            ),
        )
        .meta(blockMeta("traffic_row", "i-ph-chart-line")),
    )
    .child(
      "tops",
      Grid({ minColumnWidth: "420px" })
        .child(
          "content",
          GridRow()
            .child(
              "content",
              topListTabs(
                "content",
                "i-ph-files",
                `${MARKETING_MODULE_PATH}/pages`,
              ),
            )
            .child(
              "acquisition",
              topListTabs(
                "acquisition",
                "i-ph-megaphone",
                `${MARKETING_MODULE_PATH}/acquisition`,
              ),
            ),
        )
        .child(
          "audience",
          GridRow()
            .child(
              "audience",
              topListTabs("audience", "i-ph-globe-hemisphere-west"),
            )
            .child(
              "events",
              topListTabs(
                "events",
                "i-ph-sparkle",
                `${MARKETING_MODULE_PATH}/funnel-builder`,
              ),
            ),
        )
        .meta(blockMeta("tops", "i-ph-list-numbers")),
    );
}
