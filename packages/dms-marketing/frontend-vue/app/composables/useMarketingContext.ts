import {
  computed,
  inject,
  ref,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from 'vue'

/** `imported`: data, but only from an import — nothing proves the tag collects. */
export type WebsiteState = 'live' | 'imported' | 'waiting' | 'paused'

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
  select: (id: string) => Promise<void>
  reload: () => Promise<void>
  /** A switch is being saved: the picker shows it loading. */
  switching: Ref<boolean>
  /**
   * Whether the bar shows the website picker. Off (`websitePicker: false`),
   * a block of the page carries it (see utils/website-picker).
   */
  websitePicker: ComputedRef<boolean>
  /** A website's state as the bar shows it, on the bar's clock. */
  describe: (site: ContextWebsite) => ContextWebsiteState
}

/** A website's state in words: its dot, the full line, the compact one. */
export interface ContextWebsiteState {
  dot: string
  line: string
  short: string
}

export const MARKETING_CONTEXT_KEY: InjectionKey<MarketingContextState> =
  Symbol('dms-marketing-context')

/**
 * The context of the page the block sits on. Outside a context container (a
 * block dropped on another page) the website is unknown and the routes fall
 * back to the caller's own selection. The period is the DMS period scope's
 * (`usePeriodScope`), which the bar's selector publishes.
 */
export function useMarketingContext(): MarketingContextState {
  return inject(MARKETING_CONTEXT_KEY, () => detachedContext(), true)
}

function detachedContext(): MarketingContextState {
  return {
    websites: computed(() => []),
    selected: computed(() => null),
    select: async () => {},
    reload: async () => {},
    switching: ref(false),
    websitePicker: computed(() => true),
    describe: () => ({ dot: '', line: '', short: '' }),
  }
}
