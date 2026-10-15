import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { MarketingContextPayload } from './useMarketingContext'
import type {
  MarketingConnectionStatus,
  MarketingFunnelListItem,
  MarketingFunnelTemplate,
  MarketingPages,
  MarketingPagesSort,
  MarketingPeriod,
  MarketingWebsite,
  MarketingWebsiteCard,
} from './useMarketingApi'

/**
 * The reads the module's pages render, through `useApiData`: a server render
 * reads them and hands them to the browser with the page, the components
 * showing one request share it, and a newer request replaces one still in
 * flight (the answer for a site, page or period the user left never paints
 * over the one on screen). Writes, and the reads of the browser-only
 * surfaces (the page preview, the funnel builder), go through
 * `useMarketingApi`.
 *
 * A read bound to the period waits for it: the server knows it only once the
 * browser's time zone is known, and the browser once the context bar's
 * selector has set up. Until then nothing is read and the block shows its
 * skeleton, on both sides.
 */

/** Far above any real tenant's funnel count (the data-api caps at 100). */
const FUNNEL_LIST_LIMIT = 100

/** `url` with the period's bounds, or nothing to read without a period. */
function periodRead(
  url: string,
  period: MaybeRefOrGetter<MarketingPeriod>,
): string | null {
  const state = toValue(period)
  return state ? (appendPeriodToUrl(url, state) ?? url) : null
}

/** The tenant's websites as the context bar lists them, and the saved pick. */
export function useMarketingContextRead(): ApiDataResult<MarketingContextPayload> {
  return useApiData<MarketingContextPayload>('/api/marketing/context')
}

/** The Websites page's cards. */
export function useWebsiteCards(): ApiDataResult<MarketingWebsiteCard[]> {
  return useApiData<MarketingWebsiteCard[]>('/api/marketing/websites/summary')
}

/** The tenant's websites, with their capture options. */
export function useWebsites(): ApiDataResult<MarketingWebsite[]> {
  return useApiData<MarketingWebsite[]>('/api/marketing/websites')
}

/** The funnels of a website, oldest first; nothing read without one. */
export function useWebsiteFunnels(
  websiteId: MaybeRefOrGetter<string>,
  refreshToken: MaybeRefOrGetter<number>,
): ApiDataResult<MarketingFunnelListItem[]> {
  return useApiData<MarketingFunnelListItem[]>(
    () => (toValue(websiteId) ? '/api/marketing/tables/funnels/list' : null),
    {
      query: () => ({
        filter_websiteId: `is:${toValue(websiteId)}`,
        limit: FUNNEL_LIST_LIMIT,
        sortKey: 'createdAt',
        sortDirection: 'asc',
      }),
      watch: [() => toValue(refreshToken)],
      transform: (value) =>
        (value as { results: MarketingFunnelListItem[] }).results,
    },
  )
}

export interface PageInventoryRequest {
  websiteId: MaybeRefOrGetter<string>
  period: MaybeRefOrGetter<MarketingPeriod>
  search: MaybeRefOrGetter<string>
  sort: MaybeRefOrGetter<MarketingPagesSort>
  refreshToken: MaybeRefOrGetter<number>
}

/** The paths a website's visitors loaded over the period. */
export function usePageInventory(
  request: PageInventoryRequest,
): ApiDataResult<MarketingPages> {
  return useApiData<MarketingPages>(
    () =>
      toValue(request.websiteId)
        ? periodRead('/api/marketing/stats/pages', request.period)
        : null,
    {
      query: () => ({
        website: toValue(request.websiteId),
        search: toValue(request.search),
        sort: toValue(request.sort),
      }),
      watch: [() => toValue(request.refreshToken)],
    },
  )
}

/** Funnels built from a website's own journeys over the period. */
export function useFunnelTemplates(
  websiteId: MaybeRefOrGetter<string | undefined>,
  period: MaybeRefOrGetter<MarketingPeriod>,
): ApiDataResult<MarketingFunnelTemplate[]> {
  return useApiData<MarketingFunnelTemplate[]>(
    () =>
      toValue(websiteId)
        ? periodRead('/api/marketing/funnels/templates', period)
        : null,
    { query: () => ({ website: toValue(websiteId) }) },
  )
}

/**
 * Whether a website's tag reached the collector: since its creation, or
 * since `since` (epoch ms, server clock). Read again with `refresh()` to
 * poll it.
 */
export function useWebsiteConnection(
  websiteId: MaybeRefOrGetter<string>,
  since: MaybeRefOrGetter<number | null>,
): ApiDataResult<MarketingConnectionStatus> {
  const path = computed(() => {
    const id = toValue(websiteId)
    return id
      ? `/api/marketing/websites/${encodeURIComponent(id)}/connection`
      : null
  })
  return useApiData<MarketingConnectionStatus>(path, {
    query: () => ({ since: toValue(since) ?? undefined }),
  })
}
