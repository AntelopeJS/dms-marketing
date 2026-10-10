import type {
  ComponentBuilder,
  ComponentMetadata,
} from "@antelopejs/interface-dms/component";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { API_BASE_PATH } from "@/types/constants";

/**
 * The period scope every analytics block of the module binds to. The context
 * bar publishes it, its key carrying the selected website as well, so a stock
 * `KpiCard` refetches on a website switch like on a period change.
 */
export const MARKETING_PERIOD_SCOPE = "dms-marketing";

export const BLOCKS_API = `${API_BASE_PATH}/blocks`;

/**
 * The context the bar mirrors into the page URL (`?website=…&from=…&to=…&
 * compare=…`), as the route tokens a stock block without a period scope
 * reads it through. Such a block reads again when the bar changes the URL,
 * and requests nothing before the bar wrote it.
 */
const CONTEXT_QUERY =
  "website={{query.website}}&from={{query.from}}&to={{query.to}}&compare={{query.compare}}";

/** A route of the module read in the page's context, for a stock block. */
export function contextUrl(path: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}${CONTEXT_QUERY}`;
}

/** Options every module block reads its data with. */
export interface ScopedBlockOptions {
  fetchUrl?: string;
  periodScope?: string;
}

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

/**
 * The context bar and first-run gate wrapping an analytics page: its children
 * render once the tenant has a website, under the bar that picks the website
 * and the period they read.
 */
export function MarketingContext(): ComponentBuilder<ScopedBlockOptions> {
  return MarketingBlock("Context", "context", "i-ph-sliders-horizontal", {
    periodScope: MARKETING_PERIOD_SCOPE,
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
