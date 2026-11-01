import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { measureFillHeight } from '../../utils/fill-height'

/**
 * Side by side, the list and the preview fill the window below the context
 * bar, each scrolling inside itself: the page does not scroll, and the
 * preview's toolbar and legend stay in sight however long the page or the
 * list. Stacked (below xl), nothing is pinned: null.
 */
export function useFillPanes(SIDE_BY_SIDE_QUERY: string) {
  const panes = ref<HTMLElement | null>(null)
  const paneHeight = ref<number | null>(null)
  let paneFrame = 0

  function measurePanes(): void {
    cancelAnimationFrame(paneFrame)
    paneFrame = requestAnimationFrame(() => {
      const element = panes.value
      paneHeight.value =
        element && window.matchMedia(SIDE_BY_SIDE_QUERY).matches
          ? measureFillHeight(element)
          : null
    })
  }

  // What sits above or below the panes (a banner, the sampling note) moves
  // them: the body's size says so on a page that scrolls, this block's own on
  // a shell that scrolls a panel. Their own height leaves the answer as is,
  // so the observer settles at once.
  let paneObserver: ResizeObserver | null = null
  onMounted(() => {
    measurePanes()
    window.addEventListener('resize', measurePanes)
    paneObserver = new ResizeObserver(measurePanes)
    paneObserver.observe(document.body)
    const block = panes.value?.parentElement
    if (block) {
      paneObserver.observe(block)
    }
  })
  onBeforeUnmount(() => {
    cancelAnimationFrame(paneFrame)
    window.removeEventListener('resize', measurePanes)
    paneObserver?.disconnect()
  })

  // The panes come and go with the waiting state.
  watch(panes, (element) => element && measurePanes())

  const paneStyle = computed(() =>
    paneHeight.value === null ? undefined : { height: `${paneHeight.value}px` },
  )

  return { panes, paneHeight, paneStyle }
}
