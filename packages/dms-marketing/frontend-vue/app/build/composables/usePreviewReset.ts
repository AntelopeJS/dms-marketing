import { ref } from 'vue'
import { useHeatmapCountRead } from '../../composables/useMarketingReads'
import { heatmapDataLabel, heatmapResetImpact } from '../../utils/heatmap'
import type { PagePreviewProps } from '../types/pagePreview'
import type { useI18n } from '#dms/frontend-module'
import type { useMarketingApi } from '../../composables/useMarketingApi'

/** The reset of `PagePreview`: deleting the page's clicks, scrolls and snapshots, confirmed with what it removes. */
export function usePreviewReset(
  props: Readonly<PagePreviewProps>,
  t: ReturnType<typeof useI18n>['t'],
  locale: ReturnType<typeof useI18n>['locale'],
  api: ReturnType<typeof useMarketingApi>,
) {
  // --- Reset ------------------------------------------------------------------

  const { confirm } = useConfirm()
  const toast = useToast()
  const resetting = ref(false)

  const countPageHeatmap = useHeatmapCountRead(
    () => props.website?._id ?? '',
    () => props.path,
  )

  /** Deletes the clicks, scrolls and snapshots of the page (every period),
   *  counted by the server before asking; the page's reads follow. */
  async function resetPageHeatmap() {
    const website = props.website
    if (!website) {
      return
    }
    const path = props.path
    resetting.value = true
    const counts = await countPageHeatmap()
      .catch(() => null)
      .finally(() => (resetting.value = false))
    await confirm({
      title: t('page.marketing.pages.reset.page_title'),
      description: t('page.marketing.pages.reset.page_description'),
      color: 'error',
      icon: 'i-ph-eraser',
      confirmLabel:
        counts && counts.events + counts.snapshots > 0
          ? t('page.marketing.pages.reset.confirm_count', {
              what: heatmapDataLabel(counts, t, locale.value),
            })
          : t('page.marketing.pages.reset.confirm'),
      confirmText: path,
      impact: heatmapResetImpact(counts, t, locale.value),
      onConfirm: async () => {
        resetting.value = true
        try {
          const deleted = await api.resetHeatmap(website._id, path)
          toast.add({
            color: 'success',
            title: t('page.marketing.pages.reset.page_done'),
            description: t('page.marketing.pages.reset.done', {
              what: heatmapDataLabel(deleted, t, locale.value),
            }),
          })
          // The preview shows the emptied page before the button comes back.
          await refreshPageBlocks()
        } finally {
          resetting.value = false
        }
      },
    })
  }

  return { confirm, toast, resetting, resetPageHeatmap }
}
