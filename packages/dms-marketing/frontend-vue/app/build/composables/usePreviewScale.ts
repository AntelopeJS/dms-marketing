import { ref, watch, onBeforeUnmount, computed } from 'vue'
import type { PagePreviewProps } from '../types/pagePreview'
import type { usePreviewFrame } from './usePreviewFrame'
import type { usePreviewSnapshot } from './usePreviewSnapshot'

/**
 * The scale of `PagePreview`: the surface laid out at the layout width, zoomed
 * down to the pane, so the overlay and the page share one coordinate space at
 * any container size.
 *
 * The frame is zoomed, not `transform: scale()`d: a transformed frame is
 * rasterized at its natural size and resampled, and at a fractional scale the
 * thin borders of inputs and cards drop out, while zoom reaches the frame's
 * document as a page zoom, laid out at the same CSS width and painted crisp at
 * the scale. The pane always reserves its scrollbar (`overflow-y-scroll`):
 * letting it appear and disappear would change the width the scale is derived
 * from, which changes the height, which decides whether the scrollbar is there
 * at all.
 *
 * The scale only ever goes down: a phone or tablet layout narrower than the
 * pane is shown at its own width, centred like a device. Given a height, the
 * pane takes what the card leaves it; without one, it grows with the page up to
 * the window's height, and its border is counted or a 2px scroll would remain.
 */
export function usePreviewScale(
  layoutWidth: ReturnType<typeof usePreviewSnapshot>['layoutWidth'],
  renderHeight: ReturnType<typeof usePreviewFrame>['renderHeight'],
  props: Readonly<PagePreviewProps>,
) {
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

  const scale = computed(() =>
    containerWidth.value > 0
      ? Math.min(1, containerWidth.value / layoutWidth.value)
      : 1,
  )

  const surfaceWidth = computed(() =>
    Math.round(layoutWidth.value * scale.value),
  )

  const scrolledHeight = computed(() =>
    Math.round(renderHeight.value * scale.value),
  )

  const filled = computed(() => !!props.height)

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
