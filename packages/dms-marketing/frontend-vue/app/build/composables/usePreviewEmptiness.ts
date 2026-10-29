import { computed } from 'vue'
import type { PagePreviewProps } from '../types/pagePreview'
import type { useI18n } from '#dms/frontend-module'
import type { usePreviewReads } from './usePreviewReads'

/** Why the overlay of `PagePreview` is empty, failed, loading or truncated. */
export function usePreviewEmptiness(
  props: Readonly<PagePreviewProps>,
  t: ReturnType<typeof useI18n>['t'],
  scrollViews: ReturnType<typeof usePreviewReads>['scrollViews'],
  overlayMode: ReturnType<typeof usePreviewReads>['overlayMode'],
  loading: ReturnType<typeof usePreviewReads>['loading'],
  heatmap: ReturnType<typeof usePreviewReads>['heatmap'],
  totalClicks: ReturnType<typeof usePreviewReads>['totalClicks'],
  loadingScroll: ReturnType<typeof usePreviewReads>['loadingScroll'],
  scrollDepth: ReturnType<typeof usePreviewReads>['scrollDepth'],
  failed: ReturnType<typeof usePreviewReads>['failed'],
  scrollFailed: ReturnType<typeof usePreviewReads>['scrollFailed'],
  heatmapRead: ReturnType<typeof usePreviewReads>['heatmapRead'],
  scrollRead: ReturnType<typeof usePreviewReads>['scrollRead'],
) {
  // --- Emptiness, explained ---------------------------------------------------

  /** Silence has shared causes (collection off, no view sampled) before the
   *  per-overlay one; both overlays explain themselves through this. */
  function captureEmptyReason(fallbackKey: string): string {
    if (!props.trackerEnabled) {
      return t('page.marketing.pages.empty.tracking_off')
    }
    if (props.pageviews && scrollViews.value === 0) {
      return props.sampleRateLabel === null
        ? t('page.marketing.pages.empty.none_sampled')
        : t('page.marketing.pages.empty.none_sampled_rate', {
            rate: props.sampleRateLabel,
          })
    }
    return t(fallbackKey)
  }

  const emptyState = computed(() => {
    if (overlayMode.value === 'clicks') {
      if (loading.value || heatmap.value === null || totalClicks.value > 0) {
        return null
      }
      return {
        title: t('page.marketing.pages.empty.title'),
        description: captureEmptyReason('page.marketing.pages.empty.no_clicks'),
      }
    }
    if (
      loadingScroll.value ||
      scrollDepth.value === null ||
      scrollViews.value > 0
    ) {
      return null
    }
    return {
      title: t('page.marketing.pages.empty.scroll_title'),
      description: captureEmptyReason('page.marketing.pages.empty.no_scrolls'),
    }
  })

  // --- Per-overlay surface state ----------------------------------------------

  const activeFailed = computed(() =>
    overlayMode.value === 'clicks' ? failed.value : scrollFailed.value,
  )

  const activeLoading = computed(() =>
    overlayMode.value === 'clicks' ? loading.value : loadingScroll.value,
  )

  function retryActive(): void {
    if (overlayMode.value === 'clicks') {
      void heatmapRead.refresh()
      return
    }
    void scrollRead.refresh()
  }

  const truncatedState = computed(() => {
    if (overlayMode.value === 'clicks' && heatmap.value?.truncated) {
      return {
        title: t('page.marketing.pages.truncated'),
        description: t('page.marketing.pages.truncated_hint'),
      }
    }
    if (overlayMode.value === 'scroll' && scrollDepth.value?.truncated) {
      return {
        title: t('page.marketing.pages.scroll.truncated'),
        description: t('page.marketing.pages.scroll.truncated_hint'),
      }
    }
    return null
  })

  return {
    emptyState,
    activeFailed,
    activeLoading,
    retryActive,
    truncatedState,
  }
}
