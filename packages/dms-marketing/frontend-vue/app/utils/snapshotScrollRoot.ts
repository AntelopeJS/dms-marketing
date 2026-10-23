/**
 * The inner scroll container of a snapshot, unrolled.
 *
 * An app shell keeps its document still and scrolls a panel instead; the
 * capture marks that panel `data-marketing-scroll-root` (see
 * static/snapshot.js). Rendered as captured, the panel stays clipped at the
 * visitor's window height and everything below the fold is out of reach —
 * the frame does not scroll, and no click below the first screen has
 * anything under it. Unrolled, the panel and every ancestor that pinned its
 * height let it grow: the document becomes as tall as the content, which is
 * what the tracker's click fractions and scroll depths are measured against.
 *
 * Only the vertical axis is released. A horizontal clip stays (as `clip`,
 * which unlike `hidden` does not turn the box back into a scroll container),
 * and only a column flexbox has its items' basis touched — in a row, the
 * basis is a width.
 */

export const SCROLL_ROOT_ATTRIBUTE = 'data-marketing-scroll-root'

/** The few computed properties the unrolling reads. */
export interface UnrollStyle {
  position: string
  overflowX: string
  display: string
  flexDirection: string
}

/** The part of an element the unrolling touches. */
export interface UnrollElement {
  parentElement: UnrollElement | null
  style: { setProperty(name: string, value: string, priority: string): void }
}

function important(element: UnrollElement, name: string, value: string): void {
  element.style.setProperty(name, value, 'important')
}

function isColumnFlex(style: UnrollStyle | null): boolean {
  return (
    !!style &&
    (style.display === 'flex' || style.display === 'inline-flex') &&
    style.flexDirection.startsWith('column')
  )
}

/**
 * Releases `root` and its ancestors; `computed` reads an element's style as
 * the page laid it out.
 */
export function unrollScrollRoot<E extends UnrollElement>(
  root: E,
  computed: (element: E) => UnrollStyle,
): void {
  for (
    let element: E | null = root;
    element;
    element = element.parentElement as E | null
  ) {
    const style = computed(element)
    const parent = element.parentElement as E | null
    important(element, 'height', 'auto')
    important(element, 'max-height', 'none')
    important(element, 'overflow-y', 'visible')
    if (style.overflowX !== 'visible') {
      important(element, 'overflow-x', 'clip')
    }
    // A fixed box adds nothing to the document's scroll height, and one
    // pinned at both ends (`inset: 0`) keeps the window's height.
    if (style.position === 'fixed' || style.position === 'absolute') {
      important(element, 'position', 'absolute')
      important(element, 'bottom', 'auto')
    }
    if (parent && isColumnFlex(computed(parent))) {
      important(element, 'flex-basis', 'auto')
      important(element, 'flex-shrink', '0')
    }
  }
}

/** Unrolls the marked scroll root of a rendered snapshot, if it has one —
 *  a capture taken where the document scrolls has none and is left as is. */
export function unrollSnapshotScrollRoot(doc: Document): boolean {
  const view = doc.defaultView
  const root = doc.querySelector<HTMLElement>(`[${SCROLL_ROOT_ATTRIBUTE}]`)
  if (!view || !root) {
    return false
  }
  unrollScrollRoot<HTMLElement>(root, (element) =>
    view.getComputedStyle(element),
  )
  return true
}
