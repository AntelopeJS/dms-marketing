import { computed, ref, type ComputedRef, type Ref } from 'vue'
import { useLatestRequest } from './useLatestRequest'
import { useMarketingApi, type MarketingWebsite } from './useMarketingApi'
import { useMarketingWebsiteForm } from './useMarketingWebsiteForm'

/**
 * The tenant's tracked sites and the one currently being looked at — the
 * preamble of every marketing surface that is not scoped by a TableView.
 *
 * The list is what the endpoint returns, most-recently-active first, so the
 * default selection is a site that has something to show. A selection carried
 * in from a deep link wins over that default, but only while it still names a
 * site that exists: a stale link must land on a populated page, not a blank
 * one.
 */
export interface MarketingWebsitesState {
  websites: ComputedRef<MarketingWebsite[]>
  /** `{ label, value }` pairs for a USelect. */
  items: ComputedRef<{ label: string, value: string }[]>
  selectedId: Ref<string | undefined>
  selected: ComputedRef<MarketingWebsite | null>
  /** True until the list has answered once, then only while it refetches. */
  loading: ComputedRef<boolean>
  failed: Ref<boolean>
  load: () => Promise<void>
  create: () => Promise<void>
  showSnippet: () => Promise<void>
}

export function useMarketingWebsites(
  initialId?: string,
): MarketingWebsitesState {
  const api = useMarketingApi()
  const form = useMarketingWebsiteForm()
  const selectedId = ref<string | undefined>(initialId || undefined)
  const request = useLatestRequest(() => api.listWebsites())

  const websites = computed(() => request.data.value ?? [])
  const selected = computed(
    () => websites.value.find(site => site._id === selectedId.value) ?? null,
  )

  async function load(): Promise<void> {
    await request.run()
    const linked = websites.value.find(site => site._id === selectedId.value)
    selectedId.value = linked?._id ?? websites.value[0]?._id
  }

  async function create(): Promise<void> {
    const created = await form.openCreate()
    if (!created) {
      return
    }
    selectedId.value = created._id
    await load()
    await form.openSnippet(created)
  }

  async function showSnippet(): Promise<void> {
    if (selected.value) {
      await form.openSnippet(selected.value)
    }
  }

  return {
    websites,
    items: computed(() =>
      websites.value.map(site => ({ label: site.name, value: site._id })),
    ),
    selectedId,
    selected,
    // Not asked yet reads as loading: a component that told them apart would
    // flash its "no website tracked" state before the first answer lands.
    loading: computed(() => !request.settled.value || request.loading.value),
    failed: request.failed,
    load,
    create,
    showSnippet,
  }
}
