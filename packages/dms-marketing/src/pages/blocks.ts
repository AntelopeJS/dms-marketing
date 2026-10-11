import type {
  ComponentBuilder,
  ComponentMetadata,
} from "@antelopejs/interface-dms/component";
import { CustomComponent } from "@antelopejs/interface-dms/base/custom";
import { API_BASE_PATH } from "@/types/constants";

/**
 * The period scope every analytics block of the module binds to: the id of
 * the DMS `PeriodSelector` in the context bar, and the prefix of its keys in
 * the page URL (`?marketing.period=…`). The bar asks the blocks to read again
 * on a website switch.
 */
export const MARKETING_PERIOD_SCOPE = "marketing";

export const BLOCKS_API = `${API_BASE_PATH}/blocks`;

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
