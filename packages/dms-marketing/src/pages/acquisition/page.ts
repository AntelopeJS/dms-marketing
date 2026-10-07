import { Grid, GridRow } from "@antelopejs/interface-dms/base/grid";
import { KeyValueList } from "@antelopejs/interface-dms/base/key-value-list";
import { DefaultLayout } from "@antelopejs/interface-dms/base/layouts";
import { TopListCard } from "@antelopejs/interface-dms/base/top-list-card";
import { PageController, RegisterPage } from "@antelopejs/interface-dms/page";
import { MARKETING_MODULE_ID } from "@/types/constants";
import {
  BLOCKS_API,
  blockMeta,
  MARKETING_PERIOD_SCOPE,
  MarketingBlock,
  MarketingContext,
} from "../blocks";
import { analyticsCategory } from "../module";

const RULES_PREFIX = "$page.marketing.acquisition.rules.";

/** Why a session lands in a channel, in the order the classifier checks. */
const CHANNEL_RULES = ["paid", "email", "social", "organic", "referral"].map(
  (channel) => ({
    id: channel,
    label: `$page.marketing.channels.${channel}`,
    value: `${RULES_PREFIX}${channel}`,
  }),
);

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
    .child(
      "campaigns",
      MarketingBlock("CampaignsTable", "campaigns", "i-ph-tag", {
        fetchUrl: `${BLOCKS_API}/campaigns`,
        periodScope: MARKETING_PERIOD_SCOPE,
      }),
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
