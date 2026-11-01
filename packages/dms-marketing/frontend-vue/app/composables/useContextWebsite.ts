import { computed, type ComputedRef, type Ref } from 'vue'
import { useDmsRoute, useDmsRouter, useI18n } from '#dms/frontend-module'
import type {
  ContextWebsite,
  MarketingContextPayload,
} from './useMarketingContext'
import { useMarketingApi } from './useMarketingApi'
import { useMarketingContextRead } from './useMarketingReads'

/** The website the page reads, shared by the toolbar's picker and the gate. */
export interface ContextWebsiteState {
  context: Ref<MarketingContextPayload | null | undefined>
  /**
   * The context could not be read, and none is shown: a failed re-read (an
   * arrival, a retry) keeps what is shown.
   */
  failed: ComputedRef<boolean>
  websites: ComputedRef<ContextWebsite[]>
  /** The URL's website, while it is one of the tenant's. */
  linkedId: ComputedRef<string | null>
  selectedId: ComputedRef<string | null>
  selected: ComputedRef<ContextWebsite | null>
  /** A pick is being saved. */
  switching: Ref<boolean>
  select: (id: string) => Promise<void>
  /** The websites and their last events again; a failure keeps them as is. */
  reload: () => Promise<void>
  /** Resolves once the context was read. */
  ready: PromiseLike<unknown>
}

/**
 * The page's website: the URL's `?website=` while it names one of the
 * tenant's, else the one saved server-side. The toolbar's website picker and
 * the context gate both call it; they share the context read.
 */
export function useContextWebsite(): ContextWebsiteState {
  const { t } = useI18n()
  const api = useMarketingApi()
  const toast = useToast()
  const consumeRefusal = useReadOnlyRefusal()
  const route = useDmsRoute()
  const router = useDmsRouter()

  const contextRead = useMarketingContextRead()
  const context = contextRead.data
  const failed = computed(
    () =>
      !!contextRead.error.value &&
      contextRead.status.value !== 'pending' &&
      !context.value,
  )
  const switching = useDmsState('marketing-context-switching', () => false)

  const websites = computed(() => context.value?.websites ?? [])
  const linkedId = computed(() => {
    const id = route.query.website
    return typeof id === 'string' &&
      websites.value.some((site) => site.id === id)
      ? id
      : null
  })
  const selectedId = computed(
    () => linkedId.value ?? context.value?.selectedId ?? null,
  )
  const selected = computed<ContextWebsite | null>(
    () => websites.value.find((site) => site.id === selectedId.value) ?? null,
  )

  const reload = (): Promise<void> => contextRead.refresh()

  async function select(id: string): Promise<void> {
    if (id === selectedId.value) {
      return
    }
    switching.value = true
    try {
      // Saved first, as the website of the pages opened without one; the
      // page follows the URL once it names it. A pick is a history entry, so
      // Back takes it back.
      context.value = await api.selectContextWebsite(id)
      await router.push({ query: { ...route.query, website: id } })
    } catch (error) {
      if (!consumeRefusal(error)) {
        toast.add({
          color: 'error',
          title: t('page.marketing.context.switch_error'),
        })
      }
      await reload()
    } finally {
      switching.value = false
    }
  }

  return {
    context,
    failed,
    websites,
    linkedId,
    selectedId,
    selected,
    switching,
    select,
    reload,
    ready: contextRead,
  }
}
