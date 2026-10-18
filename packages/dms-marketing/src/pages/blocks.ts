import type {
  ComponentBuilder,
  ComponentMetadata,
} from "@antelopejs/interface-dms/component";
import { Banner } from "@antelopejs/interface-dms/base/banner";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import type { TableViewOptions } from "@antelopejs/interface-dms/base/table-view";
import type { PageLiveOptions } from "@antelopejs/interface-dms/page";
import { RegisterPageTopic } from "@antelopejs/interface-dms/realtime";
import { MARKETING_EVENTS_TOPIC } from "@/services/realtime";
import { API_BASE_PATH } from "@/types/constants";

/**
 * The period scope every analytics block of the module binds to: the id of
 * the DMS `PeriodSelector` in the context bar, and the prefix of its keys in
 * the page URL (`?marketing.period=…`). The scope appends the period to the
 * block's reads.
 */
export const MARKETING_PERIOD_SCOPE = "marketing";

export const BLOCKS_API = `${API_BASE_PATH}/blocks`;

/**
 * The website the bar keeps in the page URL (`?website=…`), as the route
 * token a block reads it through: the block reads again when the bar switches
 * it, and requests nothing before the bar wrote it. Without `website`, a route
 * falls back to the caller's saved website, which another tab may have
 * changed: every read names it.
 */
const WEBSITE_QUERY = "website={{query.website}}";

/** A route of the module read for the page's website. */
export function websiteUrl(path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${WEBSITE_QUERY}`;
}

/** The keys the period selector keeps in the page URL (the DMS `periodQueryKeys`). */
const PERIOD_KEYS = [
  "period",
  "compare",
  "from",
  "to",
  "compareFrom",
  "compareTo",
] as const;

/**
 * The page's website and period, as the query of a link leaving it: a `page`
 * or `external` action target fills the page URL's tokens, a pair the page
 * has no value for being left out, so the page it opens shows the same
 * context.
 */
export const CONTEXT_QUERY = [
  WEBSITE_QUERY,
  ...PERIOD_KEYS.map(
    (key) =>
      `${MARKETING_PERIOD_SCOPE}.${key}={{query.${MARKETING_PERIOD_SCOPE}.${key}}}`,
  ),
].join("&");

/**
 * Options every module block reads its data with. `realtimeTopic` is the
 * module's arrivals topic on every block of an analytics page: the page's
 * live gate reads it again when events come in.
 */
export interface ScopedBlockOptions {
  fetchUrl?: string;
  periodScope?: string;
  realtimeTopic?: string;
}

/**
 * What a block of an analytics page reads with: the context bar's period and
 * the module's arrivals topic. The topic makes a stock block read again on
 * each batch of events, through the page's Direct / Pause gate.
 */
export const LIVE_SCOPE = {
  periodScope: MARKETING_PERIOD_SCOPE,
  realtimeTopic: MARKETING_EVENTS_TOPIC,
} as const;

/**
 * The `liveHold` of an analytics table: paused, its rows stay as they are and
 * a strip counts the events that came in since ("12 new events · Show").
 */
export const LIVE_TABLE_HOLD: NonNullable<TableViewOptions["liveHold"]> = {
  missedLabel: "$page.marketing.live.new_events",
};

/**
 * A block this module renders itself, addressed by its registered name
 * (`DmsMarketing<name>`). `.meta()` titles its permission with a translated
 * name and description, read from `page.marketing.blocks.<key>`.
 */
export function MarketingBlock<T extends object>(
  name: string,
  key: string,
  icon: string,
  options?: T,
): ComponentBuilder<T> {
  return (CustomComponent(`DmsMarketing${name}`) as ComponentBuilder<T>)
    .options(options)
    .meta({
      name: `$page.marketing.blocks.${key}.name`,
      description: `$page.marketing.blocks.${key}.description`,
      icon,
    });
}

export interface MarketingContextOptions extends ScopedBlockOptions {
  /**
   * While the website has not received its first event, show the way to the
   * install guide in place of the children: a page of zeros reads nothing.
   */
  waitingGuide?: boolean;
  /**
   * The page holds stock blocks that take no `realtimeTopic` (`KpiCard`):
   * on each batch of events the bar asks every block of the page to read
   * again (`refreshLivePageBlocks()`), through the live gate.
   */
  refreshBlocksOnEvents?: boolean;
  /**
   * Lead the bar with the website picker and the site's state (default
   * `true`). `false` leaves them to a block of the page that places its own
   * (it reads and switches the website through the bar's context): the bar
   * still keeps the website in the URL and fills in the remembered one.
   */
  websitePicker?: boolean;
}

/**
 * The `live` option of a page under the context bar. In Direct each block
 * reads again on the module's arrivals (`MARKETING_EVENTS_TOPIC`), at most
 * every 15 s while the period spans a week or less and every minute past
 * that: a month of data barely moves in 15 s, and the funnels read raw
 * events. The bar's Direct / Pause toggle stops it, and the choice follows
 * the reader from one analytics page to the next.
 */
export const CONTEXT_PAGE_LIVE: PageLiveOptions = {
  maxRate: 15,
  slowRateAfter: { period: "8d", maxRate: 60 },
  rememberKey: MARKETING_PERIOD_SCOPE,
};

/**
 * The context bar and first-run gate wrapping an analytics page: its children
 * render once the tenant has a website, under the bar that picks the website
 * and the period they read. The bar is the DMS `PageToolbar` (website, live
 * toggle, period), so the page needs no toolbar of its own. It binds the
 * arrivals topic to its page, so a page of custom blocks only (their
 * `useApiData` reads follow the page's topics) hears it too.
 */
export function MarketingContext(
  options: Omit<MarketingContextOptions, "periodScope" | "realtimeTopic"> = {},
): ComponentBuilder<MarketingContextOptions> {
  return MarketingBlock("Context", "context", "i-ph-sliders-horizontal", {
    ...LIVE_SCOPE,
    ...options,
  }).onCreated((page) => {
    const pageId = page.pageInfo?.fullId;
    if (pageId) {
      RegisterPageTopic(pageId, MARKETING_EVENTS_TOPIC);
    }
  });
}

/** Translated permission title for a stock block. */
export function blockMeta(key: string, icon: string): ComponentMetadata {
  return {
    name: `$page.marketing.blocks.${key}.name`,
    description: `$page.marketing.blocks.${key}.description`,
    icon,
  };
}

/**
 * The module-wide "collection paused" notice, a stock `Banner` the Websites
 * grid and the install guide place as their child: the route answers nothing
 * while the module collects.
 */
export function collectionPausedBanner() {
  return Banner({ fetchUrl: `${BLOCKS_API}/collection-notice` }).meta(
    blockMeta("collection_paused", "i-ph-pause-circle"),
  );
}
