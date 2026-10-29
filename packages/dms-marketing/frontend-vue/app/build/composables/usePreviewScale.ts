import { ref, watch, onBeforeUnmount, computed } from 'vue'
import type { PagePreviewProps } from '../types/pagePreview'
import type { usePreviewFrame } from './usePreviewFrame'
import type { usePreviewSnapshot } from './usePreviewSnapshot'

/** The scale of `PagePreview`: the surface laid out at the layout width, zoomed down to the pane. */
export function usePreviewScale(
  layoutWidth: ReturnType<typeof usePreviewSnapshot>['layoutWidth'],
  renderHeight: ReturnType<typeof usePreviewFrame>['renderHeight'],
  props: Readonly<PagePreviewProps>,
) {
  // The surface is laid out at `layoutWidth` and zoomed down to the pane, so the
  // overlay and the page share one coordinate space at any container size.
  // `zoom`, not `transform: scale()`: a transformed frame is rasterized at its
  // natural size and resampled, and at a fractional scale the thin borders of
  // inputs and cards drop out; zoom reaches the frame's document as a page
  // zoom, laid out at the same CSS width and painted crisp at the scale. The
  // pane always reserves its scrollbar (`overflow-y-scroll`): letting it appear
  // and disappear would change the width the scale is derived from, which
  // changes the height, which decides whether the scrollbar is there at all.
  const container = ref<HTMLElement | null>(null)
  const containerWidth = ref(0)
  let observer: ResizeObserver | null = null

  watch(container, (el) => {
    observer?.disconnect()
    observer = null
    if (!el) {
      return
    }
    containerWidth.value = el.clientWidth
    observer = new ResizeObserver(() => {
      containerWidth.value = el.clientWidth
    })
    observer.observe(el)
  })

  onBeforeUnmount(() => observer?.disconnect())

  // Only ever scaled down: a phone or tablet layout narrower than the pane is
  // shown at its own width, centred like a device, never blown up to fill it.
  const scale = computed(() =>
    containerWidth.value > 0
      ? Math.min(1, containerWidth.value / layoutWidth.value)
      : 1,
  )

  /** Width of the drawn surface in the pane's own pixels. */
  const surfaceWidth = computed(() =>
    Math.round(layoutWidth.value * scale.value),
  )

  /** Height of the zoomed surface in the pane's own pixels — the scroll range
   *  of the pane and the space the scroll-depth overlay draws in. */
  const scrolledHeight = computed(() =>
    Math.round(renderHeight.value * scale.value),
  )

  const filled = computed(() => !!props.height)

  /**
   * Given a height, the pane takes what the card leaves it, the same for
   * every snapshot: a long page scrolls inside it, a short one ends on the
   * end-of-page band. Without one, the pane grows with the page up to the
   * window's height. The border is counted, or a 2px scroll would remain.
   */
  const paneStyle = computed(() =>
    filled.value
      ? { height: '100%' }
      : {
          height: `${scrolledHeight.value + 2}px`,
          maxHeight: 'calc(100dvh - 8rem)',
          minHeight: '12rem',
        },
  )

  return {
    container,
    containerWidth,
    scale,
    surfaceWidth,
    scrolledHeight,
    filled,
    paneStyle,
  }
}
