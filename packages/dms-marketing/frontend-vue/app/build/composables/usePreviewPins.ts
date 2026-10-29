import { computed } from 'vue'
import { type ClickedElement, type Pin } from '../types/pagePreview'
import type { usePreviewFrame } from './usePreviewFrame'
import type { usePreviewReads } from './usePreviewReads'
import type { usePreviewScale } from './usePreviewScale'
import type { usePreviewSnapshot } from './usePreviewSnapshot'

/** The most clicked elements of `PagePreview` and the pins drawn on them. */
export function usePreviewPins(
  points: ReturnType<typeof usePreviewReads>['points'],
  anchorKey: ReturnType<typeof usePreviewFrame>['anchorKey'],
  anchorBoxes: ReturnType<typeof usePreviewFrame>['anchorBoxes'],
  overlayMode: ReturnType<typeof usePreviewReads>['overlayMode'],
  scale: ReturnType<typeof usePreviewScale>['scale'],
  layoutWidth: ReturnType<typeof usePreviewSnapshot>['layoutWidth'],
) {
  // --- Most clicked -----------------------------------------------------------

  const MOST_CLICKED = 5

  /** The anchored elements with the most clicks, the backend's own cells summed. */
  const mostClicked = computed<ClickedElement[]>(() => {
    const groups = new Map<string, ClickedElement>()
    for (const point of points.value) {
      if (!point.anchor) {
        continue
      }
      const key = anchorKey(point.anchor)
      const existing = groups.get(key)
      if (existing) {
        existing.weight += point.weight
        continue
      }
      const box = anchorBoxes.value.get(key)
      groups.set(key, {
        key,
        selector: point.anchor.selector,
        weight: point.weight,
        text: box?.text ?? '',
        box,
      })
    }
    return [...groups.values()]
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MOST_CLICKED)
  })

  /** Half a pin's footprint on screen, and the step that unstacks two pins. */
  const PIN_HALF_WIDTH = 28
  const PIN_HALF_HEIGHT = 11
  const PIN_STEP = 22

  /**
   * Count badges pinned on the hottest elements, in the surface's own pixels:
   * kept inside the surface (an element flush with the right edge would cut
   * its badge in half) and pushed down past the badges already placed.
   */
  const pins = computed(() => {
    if (overlayMode.value !== 'clicks') {
      return []
    }
    const unit = 1 / scale.value
    const placed: Pin[] = []
    for (const element of mostClicked.value) {
      const box = element.box
      if (!box) {
        continue
      }
      const left = Math.min(
        Math.max(box.x + box.width, PIN_HALF_WIDTH * unit),
        layoutWidth.value - PIN_HALF_WIDTH * unit,
      )
      let top = Math.max(box.y, PIN_HALF_HEIGHT * unit)
      while (
        placed.some(
          (pin) =>
            Math.abs(pin.left - left) < 2 * PIN_HALF_WIDTH * unit &&
            Math.abs(pin.top - top) < PIN_STEP * unit,
        )
      ) {
        top += PIN_STEP * unit
      }
      placed.push({ key: element.key, weight: element.weight, left, top })
    }
    return placed
  })

  return { mostClicked, pins }
}
