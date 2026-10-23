/**
 * Height that lets an element fill what is left of its scroll viewport: the
 * viewport's height, minus where the element starts and minus whatever the
 * page lays out after it (a note, the shell's bottom padding), so the page
 * itself has nothing left to scroll. All in the scroll content's
 * coordinates, so the answer does not move as the page scrolls.
 *
 * What follows the element is measured from the layout itself, never from
 * the scroll content's height: once the content is shorter than the
 * viewport, `scrollHeight` is the viewport's height, the empty space below
 * the element would read as content after it, and the element could never
 * grow with the window.
 */

/** Below this the panes stop shrinking and the page scrolls instead. */
export const MIN_FILL_HEIGHT = 480

export interface FillGeometry {
  /** Height of the scroll viewport (the window, or the shell's panel). */
  viewHeight: number
  /** Where the element starts in the scroll content. */
  top: number
  /** What the content lays out after the element (see trailingExtent). */
  trailing: number
}

export function fillHeight(geometry: FillGeometry): number {
  return Math.max(
    Math.floor(geometry.viewHeight - geometry.top - geometry.trailing),
    MIN_FILL_HEIGHT,
  )
}

/** One step from the element up to the scroll root: a box and its parent. */
export interface TrailingLevel {
  /** Bottom of the box's border box. */
  bottom: number
  /** The box's bottom margin, what it adds when nothing follows it. */
  marginBottom: number
  /** Bottoms (margin included) of the in-flow siblings after the box. */
  following: number[]
  /** The parent's bottom padding and border. */
  closing: number
}

/**
 * What the content lays out after the element: at each level, how far the
 * box's following siblings reach past its own bottom, and the parent's
 * closing padding. Each level is counted from the box's actual bottom, so a
 * box stretched to the viewport (`min-height: 100%`) adds nothing for its
 * empty space, and the sum does not depend on the viewport's height.
 */
export function trailingExtent(levels: TrailingLevel[]): number {
  let trailing = 0
  for (const level of levels) {
    trailing +=
      level.following.length > 0
        ? Math.max(Math.max(...level.following) - level.bottom, 0)
        : level.marginBottom
    trailing += level.closing
  }
  return trailing
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

function px(value: string): number {
  return Number.parseFloat(value) || 0
}

function inFlow(style: CSSStyleDeclaration): boolean {
  return (
    style.display !== 'none' &&
    style.position !== 'absolute' &&
    style.position !== 'fixed'
  )
}

/** The levels from the element up to the scroll root (the viewport, or the
 * document element), read off the page. */
function trailingLevels(element: Element, root: Element): TrailingLevel[] {
  const levels: TrailingLevel[] = []
  for (let node = element; node !== root && node.parentElement;) {
    const parent: Element = node.parentElement
    const following: number[] = []
    for (let next = node.nextElementSibling; next;) {
      const style = getComputedStyle(next)
      if (inFlow(style)) {
        following.push(
          next.getBoundingClientRect().bottom + px(style.marginBottom),
        )
      }
      next = next.nextElementSibling
    }
    const parentStyle = getComputedStyle(parent)
    levels.push({
      bottom: node.getBoundingClientRect().bottom,
      marginBottom: px(getComputedStyle(node).marginBottom),
      following,
      // A scroll viewport's border is outside its clientHeight.
      closing:
        px(parentStyle.paddingBottom) +
        (parent === root && root !== document.documentElement
          ? 0
          : px(parentStyle.borderBottomWidth)),
    })
    node = parent
  }
  return levels
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
      trailing: trailingExtent(trailingLevels(element, root)),
    })
  }
  const origin = viewport.getBoundingClientRect().top - viewport.scrollTop
  return fillHeight({
    viewHeight: viewport.clientHeight,
    top: box.top - origin,
    trailing: trailingExtent(trailingLevels(element, viewport)),
  })
}
