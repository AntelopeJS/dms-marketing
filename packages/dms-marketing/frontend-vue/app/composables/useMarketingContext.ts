import {
  computed,
  inject,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue'

export type WebsiteState = 'live' | 'waiting' | 'paused'

export interface ContextWebsite {
  id: string
  name: string
  domain: string
  state: WebsiteState
  lastActivityAt: number | null
}

export interface MarketingContextPayload {
  websites: ContextWebsite[]
  selectedId: string | null
}

/** What the context container hands the blocks it wraps. */
export interface MarketingContextState {
  websites: ComputedRef<ContextWebsite[]>
  selected: ComputedRef<ContextWebsite | null>
  /** Days of the period, as the `Nd` window the older routes read. */
  period: ComputedRef<string>
  /** Bumped by the bar's refresh button. */
  refreshToken: Ref<number>
  select: (id: string) => Promise<void>
  reload: () => Promise<void>
}

export const MARKETING_CONTEXT_KEY: InjectionKey<MarketingContextState> =
  Symbol('dms-marketing-context')

/**
 * The context of the page the block sits on. Outside a context container (a
 * block dropped on another page) the website is unknown and the routes fall
 * back to the caller's own selection.
 */
export function useMarketingContext(): MarketingContextState {
  return inject(MARKETING_CONTEXT_KEY, () => detachedContext(), true)
}

function detachedContext(): MarketingContextState {
  return {
    websites: computed(() => []),
    selected: computed(() => null),
    period: computed(() => '30d'),
    refreshToken: { value: 0 } as Ref<number>,
    select: async () => {},
    reload: async () => {},
  }
}

/**
 * The key the container publishes its period under: the period's own key and
 * the website, so a block bound to the scope refetches on either.
 */
export function contextScopeKey(
  periodKey: string,
  websiteId: string | null,
  refreshToken: number,
): string {
  return `${periodKey}|website:${websiteId ?? ''}|refresh:${refreshToken}`
}
