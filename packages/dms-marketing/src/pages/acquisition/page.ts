import { Banner } from "@antelopejs/interface-dms/base/banner";
import { DefaultDataTypes } from "@antelopejs/interface-dms/base/data-types/default-types";
import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { KeyValueList } from "@antelopejs/interface-dms/base/key-value-list";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { TableView } from "@antelopejs/interface-dms/base/table-view";
import { DefaultDisplays } from "@antelopejs/interface-dms/base/table-view/column-display";
import { TopListCard } from "@antelopejs/interface-dms/base/top-list-card";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { MARKETING_CHANNELS, type MarketingChannel } from "@/types";
import { MARKETING_MODULE_ID } from "@/types/constants";
import {
  BLOCKS_API,
  blockMeta,
  contextUrl,
  MARKETING_PERIOD_SCOPE,
  MarketingBlock,
  MarketingContext,
} from "../blocks";
import { analyticsCategory } from "../module";

/** The icon of each channel, as the frontend draws it elsewhere. */
const CHANNEL_ICONS: Record<MarketingChannel, string> = {
  direct: "i-ph-arrow-elbow-down-right",
  organic: "i-ph-magnifying-glass",
  email: "i-ph-envelope-simple",
  referral: "i-ph-link",
  social: "i-ph-share-network",
  paid: "i-ph-currency-eur",
};

const RULES_PREFIX = "$page.marketing.acquisition.rules.";

/** Why a session lands in a channel, in the order the classifier checks. */
const CHANNEL_RULES = ["paid", "email", "social", "organic", "referral"].map(
  (channel) => ({
    id: channel,
    label: `$page.marketing.channels.${channel}`,
    value: `${RULES_PREFIX}${channel}`,
  }),
);

const CAMPAIGNS_PREFIX = "$page.marketing.acquisition.campaigns.";

const monoText = () => ({
  type: new DefaultDataTypes.StringType(),
  display: new DefaultDisplays.MonoDisplay(),
  sortable: true,
});

/**
 * Every UTM-tagged source × medium × campaign of the period: a stock source
 * table over `/blocks/campaigns/rows`, which reads the context the bar
 * mirrors into the page URL. The route searches every combination of the
 * period and narrows on a channel tab; the browser sorts.
 */
const campaignsTable = TableView.fromSource({
  caption: `${CAMPAIGNS_PREFIX}title`,
  fetchUrl: contextUrl(`${BLOCKS_API}/campaigns/rows`),
  capabilities: { search: true, filter: true },
  searchPlaceholder: `${CAMPAIGNS_PREFIX}filter`,
  pageSize: 25,
  defaultSort: { field: "sessions", desc: true },
  columns: {
    campaign: {
      name: `${CAMPAIGNS_PREFIX}campaign`,
      order: 1,
      type: new DefaultDataTypes.StringType(),
      display: new DefaultDisplays.TwoLineDisplay({
        emptyLabel: `${CAMPAIGNS_PREFIX}not_set`,
      }),
      sortable: true,
    },
    source: { name: `${CAMPAIGNS_PREFIX}source`, order: 2, ...monoText() },
    medium: { name: `${CAMPAIGNS_PREFIX}medium`, order: 3, ...monoText() },
    channel: {
      name: `${CAMPAIGNS_PREFIX}channel`,
      order: 4,
      filterable: true,
      type: new DefaultDataTypes.SelectType({
        items: MARKETING_CHANNELS.map((channel) => ({
          value: channel,
          label: `$page.marketing.channels.${channel}`,
          icon: CHANNEL_ICONS[channel],
        })),
      }),
    },
    sessions: {
      name: `${CAMPAIGNS_PREFIX}sessions`,
      order: 5,
      type: new DefaultDataTypes.NumberType(),
      display: new DefaultDisplays.TwoLineDisplay({ subField: "share" }),
      sortable: true,
    },
    daily: {
      name: `${CAMPAIGNS_PREFIX}per_day`,
      order: 6,
      type: new DefaultDataTypes.StringType(),
      display: new DefaultDisplays.SparklineDisplay({ field: "daily" }),
    },
    missingMedium: {
      name: `${CAMPAIGNS_PREFIX}flags`,
      order: 7,
      type: new DefaultDataTypes.BooleanType(),
      display: new DefaultDisplays.IndicatorDisplay({
        onLabel: `${CAMPAIGNS_PREFIX}missing_medium`,
        onIcon: "i-ph-warning",
        onTone: "warning",
        offLabel: "—",
        offIcon: "",
      }),
    },
  },
  tabs: [
    { id: "all", label: `${CAMPAIGNS_PREFIX}all` },
    ...MARKETING_CHANNELS.map((channel) => ({
      id: channel,
      label: `$page.marketing.channels.${channel}`,
      icon: CHANNEL_ICONS[channel],
      filter: { accessorKey: "channel", mode: "is", value: channel },
    })),
  ],
  emptyStates: {
    firstRun: {
      icon: "i-ph-megaphone",
      title: `${CAMPAIGNS_PREFIX}empty_title`,
      description: `${CAMPAIGNS_PREFIX}empty_description`,
    },
    filtered: {
      icon: "i-ph-magnifying-glass",
      title: `${CAMPAIGNS_PREFIX}no_match`,
    },
  },
  footer: {
    countLabel: `${CAMPAIGNS_PREFIX}count`,
    hint: `${CAMPAIGNS_PREFIX}note`,
  },
});

/** A notice under the campaigns table, shown only when the route has one. */
function campaignNotice(kind: "missing" | "truncated") {
  return Banner({
    fetchUrl: contextUrl(`${BLOCKS_API}/campaigns/notice?kind=${kind}`),
  });
}

function topDimension(dimension: string, key: string, icon: string) {
  return TopListCard({
    title: `$page.marketing.acquisition.tops.${key}`,
    fetchUrl: `${BLOCKS_API}/top?dimension=${dimension}&limit=5`,
    periodScope: MARKETING_PERIOD_SCOPE,
    valueFormat: "number",
    showRank: true,
    highlightTopN: 3,
    skeletonCount: 5,
    emptyLabel: "$page.marketing.acquisition.tops.empty",
  }).meta(blockMeta(`acquisition_${key}`, icon));
}

/**
 * Acquisition — where sessions come from: the channel split with its change,
 * how a session gets its channel, every UTM-tagged campaign, and the
 * referrers, contents and terms behind them.
 */
@RegisterPage()
export class MarketingAcquisitionPage extends PageController(
  "acquisition",
  {
    displayName: "$page.marketing.acquisition.title",
    description: "$page.marketing.acquisition.description",
    icon: "i-ph-megaphone",
    module: MARKETING_MODULE_ID,
    category: analyticsCategory,
    order: 2,
  },
  DefaultLayout(),
) {
  static content = MarketingContext()
    .child(
      "channels",
      Grid({ minColumnWidth: "320px" })
        .child(
          "row",
          GridRow()
            .child(
              "split",
              MarketingBlock(
                "ChannelsCard",
                "channels",
                "i-ph-chart-bar-horizontal",
                {
                  fetchUrl: `${BLOCKS_API}/channels`,
                  periodScope: MARKETING_PERIOD_SCOPE,
                },
              ),
              { colSpan: 2 },
            )
            .child(
              "rules",
              KeyValueList({
                title: "$page.marketing.acquisition.rules.title",
                items: CHANNEL_RULES,
              }).meta(blockMeta("channel_rules", "i-ph-info")),
            ),
        )
        .meta(blockMeta("channels_row", "i-ph-chart-bar-horizontal")),
    )
    .child("campaigns", campaignsTable.meta(blockMeta("campaigns", "i-ph-tag")))
    .child(
      "missing_medium",
      campaignNotice("missing").meta(
        blockMeta("campaigns_missing", "i-ph-warning"),
      ),
    )
    .child(
      "truncated",
      campaignNotice("truncated").meta(
        blockMeta("campaigns_truncated", "i-ph-list"),
      ),
    )
    .child(
      "tops",
      Grid({ minColumnWidth: "280px" })
        .child(
          "row",
          GridRow()
            .child(
              "referrers",
              topDimension("topReferrers", "referrers", "i-ph-link"),
            )
            .child(
              "contents",
              topDimension("topUtmContents", "contents", "i-ph-cursor-click"),
            )
            .child(
              "terms",
              topDimension("topUtmTerms", "terms", "i-ph-text-aa"),
            ),
        )
        .meta(blockMeta("acquisition_tops", "i-ph-list-numbers")),
    );
}
