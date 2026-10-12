import { ButtonVariant } from "@antelopejs/interface-dms/base/types/button";
import { ChartArea } from "@antelopejs/interface-dms/base/chart";
import { ChartCard } from "@antelopejs/interface-dms/base/chart-card";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { KpiCard } from "@antelopejs/interface-dms/base/kpi-card";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { StatGroup } from "@antelopejs/interface-dms/base/stat-group";
import { Tab, TabVariant } from "@antelopejs/interface-dms/base/tab";
import { TopListCard } from "@antelopejs/interface-dms/base/top-list-card";
import { Size } from "@antelopejs/interface-dms/base/types/size";
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
  CONTEXT_PAGE_LIVE,
  MarketingContext,
  websiteUrl,
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
    // The trend badge carries the change: the line only draws the days, and
    // never reads as a fall nobody compared.
    sparklineAccent: "primary",
    compareLabel: COMPARE_LABEL,
    fetchUrl: websiteUrl(`${BLOCKS_API}/kpi?metric=${metric}`),
    periodScope: MARKETING_PERIOD_SCOPE,
  }).meta(blockMeta(`kpi_${metric.replaceAll("-", "_")}`, icon));
}

const TRAFFIC_PREFIX = "$page.marketing.overview.traffic.";

/** The traffic curve of one metric, by day, or by hour over a single day. */
function trafficChart(metric: "sessions" | "pageviews") {
  return ChartCard({
    title: `${TRAFFIC_PREFIX}${metric}_title`,
    icon: "i-ph-chart-line",
    fetchUrl: websiteUrl(`${BLOCKS_API}/traffic?metric=${metric}`),
    periodScope: MARKETING_PERIOD_SCOPE,
    valueFormat: "number",
    primaryLabel: `${TRAFFIC_PREFIX}this_period`,
    comparisonLabel: `${TRAFFIC_PREFIX}compared_period`,
    // Straight: a smoothed line between daily counts draws peaks and dips no
    // day had.
    chart: ChartArea({
      curve: "straight",
      xaxisType: "datetime",
      comparisonStyle: "dashed",
      height: "260px",
    }),
  }).meta(blockMeta(`traffic_${metric}`, "i-ph-chart-line"));
}

function topListTabs(group: string, icon: string, footer?: string) {
  return MarketingBlock("TopListTabs", `tops_${group}`, icon, {
    fetchUrl: websiteUrl(`${BLOCKS_API}/tops?group=${group}`),
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
    live: CONTEXT_PAGE_LIVE,
  },
  DefaultLayout({
    headerActions: [
      {
        id: "view-funnels",
        label: "$page.marketing.overview.view_funnels",
        icon: "i-ph-funnel",
        variant: ButtonVariant.outline,
        color: "neutral",
        target: { type: "page", url: `${MARKETING_MODULE_PATH}/funnels` },
      },
    ],
  }),
) {
  static content = MarketingContext({ waitingGuide: true })
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
        fetchUrl: websiteUrl(`${BLOCKS_API}/quality`),
        periodScope: MARKETING_PERIOD_SCOPE,
        label: "$page.marketing.blocks.quality.name",
        skeletonCount: 3,
      }).meta(blockMeta("quality", "i-ph-gauge")),
    )
    .child(
      "traffic",
      // Three 280px tracks fit the content of a 1280px window, so the wide card
      // keeps its side card on the same row on a laptop.
      Grid({ minColumnWidth: "280px" })
        .child(
          "row",
          GridRow()
            .child(
              "chart",
              Tab({
                items: [
                  { label: `${TRAFFIC_PREFIX}tabs.sessions`, slot: "sessions" },
                  {
                    label: `${TRAFFIC_PREFIX}tabs.pageviews`,
                    slot: "pageviews",
                  },
                ],
                variant: TabVariant.link,
                size: Size.small,
              })
                .child("sessions", trafficChart("sessions"), {
                  slot: "sessions",
                })
                .child("pageviews", trafficChart("pageviews"), {
                  slot: "pageviews",
                })
                .meta(blockMeta("traffic", "i-ph-chart-line")),
              { colSpan: 2 },
            )
            .child(
              "devices",
              TopListCard({
                title: "$page.marketing.overview.devices.title",
                fetchUrl: websiteUrl(`${BLOCKS_API}/devices`),
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
