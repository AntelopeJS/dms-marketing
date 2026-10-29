import {
  type PagePreviewRequest,
  usePageHeatmap,
  usePageScrollDepth,
} from '../../composables/useMarketingReads'
import { computed, ref } from 'vue'
import type { PagePreviewProps } from '../types/pagePreview'

/** The reads of `PagePreview`: the clicks and the scroll depth of the page over the period, with their states. */
export function usePreviewReads(props: Readonly<PagePreviewProps>) {
  // --- Heatmap ----------------------------------------------------------------

  // Path, site and period all read again, and a newer read replaces one still
  // in flight: a slow answer for the page the user just left never repaints
  // over the one on screen. Drawn in the browser only.
  const previewRequest: PagePreviewRequest = {
    websiteId: () => props.website?._id,
    path: () => props.path,
    period: () => props.period,
    workspace: () => props.workspace,
  }
  const heatmapRead = usePageHeatmap(previewRequest)
  const heatmap = computed(() =>
    heatmapRead.error.value ? null : heatmapRead.data.value,
  )
  const loading = computed(() => heatmapRead.pending.value)
  const failed = computed(() => !!heatmapRead.error.value && !loading.value)

  const points = computed(() => heatmap.value?.points ?? [])
  const maxWeight = computed(() => heatmap.value?.maxWeight ?? 0)
  const totalClicks = computed(() => heatmap.value?.totalClicks ?? 0)

  // --- Scroll depth -----------------------------------------------------------

  const overlayMode = ref<'clicks' | 'scroll'>('clicks')

  // Read with the clicks, not when its overlay opens: every sampled view
  // reports one depth, so its count is the page's sampled views the header
  // and the empty states speak of.
  const scrollRead = usePageScrollDepth(previewRequest)
  const scrollDepth = computed(() =>
    scrollRead.error.value ? null : scrollRead.data.value,
  )
  const loadingScroll = computed(() => scrollRead.pending.value)
  const scrollFailed = computed(
    () => !!scrollRead.error.value && !loadingScroll.value,
  )

  const scrollViews = computed(() => scrollDepth.value?.views ?? 0)
  const scrollReached = computed(() => scrollDepth.value?.reached ?? [])

  /** Deepest depth at least half of the sampled views reached. */
  const medianDepth = computed(() => {
    const half = scrollViews.value / 2
    for (let depth = scrollReached.value.length - 1; depth >= 0; depth--) {
      if ((scrollReached.value[depth] ?? 0) >= half) {
        return depth
      }
    }
    return 0
  })

  return {
    heatmapRead,
    heatmap,
    loading,
    failed,
    points,
    maxWeight,
    totalClicks,
    overlayMode,
    scrollRead,
    scrollDepth,
    loadingScroll,
    scrollFailed,
    scrollViews,
    scrollReached,
    medianDepth,
  }
}
