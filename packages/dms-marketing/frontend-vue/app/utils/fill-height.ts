/**
 * Height that lets an element fill what is left of its scroll viewport: the
 * viewport's height, minus where the element starts and minus whatever the
 * page lays out after it (a note, the shell's bottom padding), so the page
 * itself has nothing left to scroll. All in the scroll content's
 * coordinates, so the answer does not move as the page scrolls.
 */

/** Below this the panes stop shrinking and the page scrolls instead. */
export const MIN_FILL_HEIGHT = 480

export interface FillGeometry {
  /** Height of the scroll viewport (the window, or the shell's panel). */
  viewHeight: number
  /** Where the element starts and ends in the scroll content. */
  top: number
  bottom: number
  /** Total height of the scroll content. */
  contentHeight: number
}

export function fillHeight(geometry: FillGeometry): number {
  const trailing = Math.max(geometry.contentHeight - geometry.bottom, 0)
  return Math.max(
    Math.floor(geometry.viewHeight - geometry.top - trailing),
    MIN_FILL_HEIGHT,
  )
}

const SCROLLING = new Set(['auto', 'scroll', 'overlay'])

/** The element's scroll viewport: an app shell scrolls a panel, a plain
 * page the document. */
function scrollViewport(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (SCROLLING.has(getComputedStyle(node).overflowY)) {
      return node
    }
  }
  return null
}

/** fillHeight for an element on screen. */
export function measureFillHeight(element: HTMLElement): number {
  const box = element.getBoundingClientRect()
  const viewport = scrollViewport(element)
  if (!viewport) {
    const root = document.documentElement
    return fillHeight({
      viewHeight: window.innerHeight,
      top: box.top + window.scrollY,
      bottom: box.bottom + window.scrollY,
      contentHeight: root.scrollHeight,
    })
  }
  const origin = viewport.getBoundingClientRect().top - viewport.scrollTop
  return fillHeight({
    viewHeight: viewport.clientHeight,
    top: box.top - origin,
    bottom: box.bottom - origin,
    contentHeight: viewport.scrollHeight,
  })
}
