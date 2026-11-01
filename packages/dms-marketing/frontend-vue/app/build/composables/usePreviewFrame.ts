import { ref, computed, nextTick, watch } from 'vue'
import {
  useSnapshotFrame,
  MIN_RENDER_HEIGHT,
  MAX_RENDER_HEIGHT,
  DEFAULT_RENDER_HEIGHT,
  MAX_RENDER_WIDTH,
  type AnchorBox,
  type AnchorRequest,
} from '../../composables/useSnapshotFrame'
import { anchorDrift } from '../../utils/anchor-drift'
import type { PagePreviewProps } from '../types/pagePreview'
import type { usePreviewReads } from './usePreviewReads'
import type { usePreviewSnapshot } from './usePreviewSnapshot'

/** The frame geometry of `PagePreview`: its measured size, the height it renders at, and the clicks anchored on the elements it holds. */
export function usePreviewFrame(
  props: Readonly<PagePreviewProps>,
  snapshot: ReturnType<typeof usePreviewSnapshot>['snapshot'],
  layoutWidth: ReturnType<typeof usePreviewSnapshot>['layoutWidth'],
  PROBE_VIEWPORT_HEIGHT: number,
  points: ReturnType<typeof usePreviewReads>['points'],
  OVERFLOW_TOLERANCE: number,
) {
  // --- Frame geometry ---------------------------------------------------------

  const frame = ref<HTMLIFrameElement | null>(null)
  const {
    measuredWidth,
    measuredHeight,
    tier,
    measureAnchors,
    missingAnchors,
  } = useSnapshotFrame(frame)

  const frameKey = computed(() =>
    [
      props.path,
      snapshot.value?.layout,
      snapshot.value?.capturedAt,
      layoutWidth.value,
    ].join('|'),
  )

  /** Viewport the frame is pinned to until its size is read. */
  const probeHeight = computed(
    () => snapshot.value?.viewport.height ?? PROBE_VIEWPORT_HEIGHT,
  )

  /**
   * Height of the drawn surface — the overlay's coordinate space. Falls back to
   * a typical long page while the real one is unknown, so the heatmap is
   * readable before (and without) any snapshot.
   */
  const renderHeight = computed(() => {
    const chosen = measuredHeight.value
    if (chosen !== null) {
      return Math.min(Math.max(chosen, MIN_RENDER_HEIGHT), MAX_RENDER_HEIGHT)
    }
    return DEFAULT_RENDER_HEIGHT
  })

  /**
   * Height of the frame itself. Pinned to the probe viewport while a reading
   * is still possible — resizing it earlier would corrupt the very number
   * being waited on. An operator override takes it back by hand.
   */
  const frameHeight = computed(() => {
    if (measuredHeight.value !== null) {
      return measuredHeight.value
    }
    return tier.value === 'pending' ? probeHeight.value : renderHeight.value
  })

  /**
   * Width the overlay maps onto. Clicks are normalized against the document's
   * `scrollWidth`, so a document wider than the frame must widen the canvas or
   * every x is compressed — while the frame itself stays at the chosen layout
   * width, which is what keeps the width buttons meaningful. The overflowing
   * part is clipped by the pane, exactly as it is clipped inside the frame.
   */
  const overlayWidth = computed(() =>
    Math.min(
      Math.max(measuredWidth.value ?? 0, layoutWidth.value),
      MAX_RENDER_WIDTH,
    ),
  )

  // --- Element anchoring ------------------------------------------------------

  /**
   * A click is stored twice: as a document fraction, and as an offset inside
   * the element it hit. Only the second survives being read back at another
   * size — a document fraction divides by a box that, on a page shorter than
   * the visitor's window, IS that window, so the same button arrives here as a
   * different fraction per visitor. Given the element's box in the layout on
   * screen, the offset puts the point back where the visitor put it.
   *
   * The boxes come from the snapshot document. Every way that can fail — no
   * snapshot, an element that no longer exists, a selector that became
   * ambiguous — resolves to no box, and a point with no box keeps its document
   * fraction, never a blank one.
   */
  const anchorBoxes = ref(new Map<string, AnchorBox>())
  /** Keys of the anchors the snapshot has no element for; null until the
   *  frame has been measured. */
  const missingAnchorKeys = ref<Set<string> | null>(null)

  function anchorKey(anchor: AnchorRequest): string {
    return `${anchor.selector}\0${anchor.nth}`
  }

  const requestedAnchors = computed(() => {
    const unique = new Map<string, AnchorRequest>()
    for (const point of points.value) {
      if (!point.anchor) {
        continue
      }
      const request = { selector: point.anchor.selector, nth: point.anchor.nth }
      unique.set(anchorKey(request), request)
    }
    return [...unique.values()]
  })

  /** Points in the overlay's coordinate space, anchored where one resolved. */
  const drawnPoints = computed(() =>
    points.value.map((point) => {
      const anchor = point.anchor
      if (!anchor) {
        return point
      }
      const box = anchorBoxes.value.get(anchorKey(anchor))
      if (!box || overlayWidth.value <= 0 || renderHeight.value <= 0) {
        return point
      }
      return {
        ...point,
        x: (box.x + anchor.ox * box.width) / overlayWidth.value,
        y: (box.y + anchor.oy * box.height) / renderHeight.value,
      }
    }),
  )

  let measureToken = 0

  /**
   * Re-measure whenever the layout the boxes were taken in changes. The token
   * drops a pass for a geometry that is no longer on screen: the frame is
   * resized from the published reading, and a box read before that resize has
   * been laid out measures the probe viewport.
   */
  async function refreshAnchorBoxes(): Promise<void> {
    const token = ++measureToken
    if (tier.value !== 'measured' || requestedAnchors.value.length === 0) {
      if (anchorBoxes.value.size > 0) {
        anchorBoxes.value = new Map()
      }
      missingAnchorKeys.value = null
      return
    }
    await nextTick()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    if (token !== measureToken) {
      return
    }
    const resolved = new Map<string, AnchorBox>()
    for (const box of measureAnchors(requestedAnchors.value)) {
      resolved.set(anchorKey(box), box)
    }
    anchorBoxes.value = resolved
    missingAnchorKeys.value = new Set(
      missingAnchors(requestedAnchors.value).map(anchorKey),
    )
  }

  /**
   * Clicks aiming at elements this snapshot does not have: drawn at their
   * document fraction, and past a threshold a sign the page changed since it
   * was captured (see anchorDrift).
   */
  const drift = computed(() => {
    const missing = missingAnchorKeys.value
    return missing
      ? anchorDrift(points.value, (anchor) => missing.has(anchorKey(anchor)))
      : null
  })

  watch(
    [requestedAnchors, tier, renderHeight, overlayWidth],
    () => void refreshAnchorBoxes(),
  )

  /**
   * The document does not fit the surface the canvas can allocate. Both are
   * clamped, so the overlay is uniformly compressed against a backdrop that
   * is merely cut off — the two no longer line up, and that is worth saying
   * rather than showing.
   */
  const oversized = computed(
    () =>
      (measuredHeight.value ?? 0) > MAX_RENDER_HEIGHT ||
      (measuredWidth.value ?? 0) > MAX_RENDER_WIDTH,
  )

  const overflowing = computed(
    () => (measuredWidth.value ?? 0) > layoutWidth.value * OVERFLOW_TOLERANCE,
  )

  return {
    frame,
    measuredWidth,
    frameKey,
    probeHeight,
    renderHeight,
    frameHeight,
    overlayWidth,
    anchorBoxes,
    anchorKey,
    drawnPoints,
    drift,
    oversized,
    overflowing,
  }
}
