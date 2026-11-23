import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { unrollSnapshotScrollRoot } from '../utils/snapshotScrollRoot'

/**
 * Geometry of a page snapshot rendered in a same-origin, script-less frame.
 *
 * The frame is `srcdoc`, sandboxed without scripts and with the console's
 * origin, so its document is ours to read: no handshake, no timeout, no
 * silence to diagnose. The size is still taken from at most ONE reading,
 * with the frame pinned at a probe viewport until then: sizing the frame
 * from a reading taken through it runs away, every `100vh` section growing
 * one tick at a time, exactly as it would with a live page. Once published,
 * later growth is ignored until `reset()`.
 *
 * A capture of an app shell scrolling an inner panel is unrolled first (see
 * snapshotScrollRoot): the reading is then the whole content, not the
 * visitor's window.
 */

/** Fallback document height when nothing measured it. */
export const DEFAULT_RENDER_HEIGHT = 3200

/** Floor on any render height, measured or typed. */
export const MIN_RENDER_HEIGHT = 400

/** Ceilings on the drawn surface: the canvas allocates width × height × 4 B. */
export const MAX_RENDER_HEIGHT = 20000
export const MAX_RENDER_WIDTH = 4000

/** Post-load growth worth waiting for: web fonts swapping in. */
const SETTLE_MS = 300

const SRCDOC_URL = 'about:srcdoc'

/**
 * `off` — no frame mounted.
 * `pending` — a frame is up, nothing published yet; it stays at probe size.
 * `measured` — a size was published; geometry comes from the snapshot.
 */
export type SnapshotTier = 'off' | 'pending' | 'measured'

/** What the overlay asks the snapshot to locate for it. */
export interface AnchorRequest {
  selector: string
  nth: number
}

/** Box of one anchor, in the snapshot document's own coordinates. */
export interface AnchorBox extends AnchorRequest {
  x: number
  y: number
  width: number
  height: number
  /** What the element reads, for the "Most clicked" list; empty on an image. */
  text: string
}

const ANCHOR_TEXT_LENGTH = 40

function readableText(element: Element): string {
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  const label =
    text ||
    element.getAttribute('aria-label') ||
    element.getAttribute('alt') ||
    element.getAttribute('title') ||
    element.querySelector('img[alt]')?.getAttribute('alt') ||
    element.querySelector('svg title')?.textContent?.trim() ||
    ''
  return label.length > ANCHOR_TEXT_LENGTH
    ? `${label.slice(0, ANCHOR_TEXT_LENGTH - 1)}…`
    : label
}

/**
 * Reads the geometry of the snapshot in `frame`. The size is published once, as
 * measured and never clamped: a document too large to draw is a decision for
 * the caller, and shrinking it here would misplace every click by the ratio it
 * was shrunk. `stop()` ends reading without publishing, for a frame the caller
 * resizes by hand, and `reset()` forgets the size and waits for the frame to
 * load again. A new frame is a new reading: the ref is only set once the iframe
 * is rendered, which the caller does conditionally and keyed.
 *
 * `measureAnchors` locates a set of anchors in the snapshot. `nth` is strict: a
 * document that no longer has that match must not project the click onto a
 * sibling of the same selector, and no box means the caller keeps the click's
 * document fractions. It is read after the frame has settled at its final size,
 * since boxes taken while it is resized measure the wrong layout.
 * `missingAnchors` returns the anchors the snapshot does not have at all (no
 * `nth` match, or a selector this document cannot parse); an element that is
 * there but not drawn at this width is not missing, it only has no box.
 */
export function useSnapshotFrame(frame: Ref<HTMLIFrameElement | null>) {
  const measuredWidth = ref<number | null>(null)
  const measuredHeight = ref<number | null>(null)

  let closed = false
  let settleTimer: ReturnType<typeof setTimeout> | null = null
  let watchedFrame: HTMLIFrameElement | null = null

  function clearTimer(): void {
    if (settleTimer !== null) {
      clearTimeout(settleTimer)
      settleTimer = null
    }
  }

  function frameDocument(): Document | null {
    const doc = frame.value?.contentDocument ?? null
    return doc && doc.URL === SRCDOC_URL ? doc : null
  }

  function publish(): void {
    const doc = frameDocument()
    if (closed || !doc) {
      return
    }
    closed = true
    clearTimer()
    const root = doc.documentElement
    measuredWidth.value = Math.max(root.scrollWidth, 1)
    measuredHeight.value = Math.max(root.scrollHeight, MIN_RENDER_HEIGHT)
  }

  function onFrameLoad(): void {
    const doc = frameDocument()
    if (!doc || closed) {
      return
    }
    unrollSnapshotScrollRoot(doc)
    void (doc.fonts?.ready ?? Promise.resolve()).then(() => {
      if (closed) {
        return
      }
      clearTimer()
      settleTimer = setTimeout(publish, SETTLE_MS)
    })
  }

  function close(): void {
    closed = true
    clearTimer()
  }

  function reset(): void {
    clearTimer()
    closed = false
    measuredWidth.value = null
    measuredHeight.value = null

    watchedFrame?.removeEventListener('load', onFrameLoad)
    watchedFrame = frame.value
    watchedFrame?.addEventListener('load', onFrameLoad)
    if (frameDocument()?.readyState === 'complete') {
      onFrameLoad()
    }
  }

  function measureAnchors(anchors: AnchorRequest[]): AnchorBox[] {
    const doc = frameDocument()
    const view = doc?.defaultView
    if (!doc || !view) {
      return []
    }
    const boxes: AnchorBox[] = []
    for (const anchor of anchors) {
      let matches: NodeListOf<Element>
      try {
        matches = doc.querySelectorAll(anchor.selector)
      } catch {
        continue
      }
      const element = matches[anchor.nth]
      const box = element?.getBoundingClientRect()
      if (!element || !box || box.width <= 0 || box.height <= 0) {
        continue
      }
      boxes.push({
        ...anchor,
        x: box.left + view.scrollX,
        y: box.top + view.scrollY,
        width: box.width,
        height: box.height,
        text: readableText(element),
      })
    }
    return boxes
  }

  function missingAnchors(anchors: AnchorRequest[]): AnchorRequest[] {
    const doc = frameDocument()
    if (!doc) {
      return []
    }
    return anchors.filter((anchor) => {
      try {
        return !doc.querySelectorAll(anchor.selector)[anchor.nth]
      } catch {
        return true
      }
    })
  }

  onBeforeUnmount(() => {
    watchedFrame?.removeEventListener('load', onFrameLoad)
    watchedFrame = null
    clearTimer()
  })

  watch(frame, reset, { immediate: true })

  const tier = computed<SnapshotTier>(() => {
    if (!frame.value) {
      return 'off'
    }
    return measuredHeight.value !== null ? 'measured' : 'pending'
  })

  return {
    measuredWidth,
    measuredHeight,
    tier,
    reset,
    close,
    measureAnchors,
    missingAnchors,
  }
}
