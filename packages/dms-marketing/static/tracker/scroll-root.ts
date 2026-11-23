import { SCROLL_ROOT_ATTRIBUTE } from "../shared/page";

/** Share of the window an inner scroll container must cover to stand for the page: less is a list, a code block or a dropdown. */
const SCROLL_ROOT_COVERAGE = 0.5;

type Probe = readonly [x: number, y: number];

/** Points of the window (fractions of its width and height) probed for an inner scroll container: one covering most of the window holds several. */
const SCROLL_ROOT_PROBES: readonly Probe[] = [
  [0.5, 0.5],
  [0.5, 0.25],
  [0.5, 0.75],
  [0.25, 0.5],
  [0.75, 0.5],
];

function documentScrolls(): boolean {
  const root = document.documentElement;
  return root.scrollHeight - root.clientHeight > 1;
}

function scrollsVertically(element: Element): boolean {
  if (element.scrollHeight - element.clientHeight <= 1) {
    return false;
  }
  const overflow = getComputedStyle(element).overflowY;
  return overflow === "auto" || overflow === "scroll";
}

/** Area of the element's box inside the window. */
function visibleArea(element: Element): number {
  const box = element.getBoundingClientRect();
  const width = Math.min(box.right, innerWidth) - Math.max(box.left, 0);
  const height = Math.min(box.bottom, innerHeight) - Math.max(box.top, 0);
  return width > 0 && height > 0 ? width * height : 0;
}

/**
 * The element scrolling the page, or null when it is the document. The
 * element marked `data-marketing-scroll-root` wins; otherwise it is found
 * from what lies under a few points of the window, never by walking the
 * whole tree: a container covering most of the window holds them.
 */
export function findScrollRoot(): Element | null {
  if (documentScrolls()) {
    return null;
  }
  const marked = document.querySelector(`[${SCROLL_ROOT_ATTRIBUTE}]`);
  if (marked) {
    return marked;
  }
  if (document.elementFromPoint === undefined) {
    return null;
  }
  const visited = new Set<Element>();
  let best: Element | null = null;
  let bestArea = innerWidth * innerHeight * SCROLL_ROOT_COVERAGE;
  for (const [fx, fy] of SCROLL_ROOT_PROBES) {
    let node = document.elementFromPoint(innerWidth * fx, innerHeight * fy);
    for (; node && !visited.has(node); node = node.parentElement) {
      visited.add(node);
      if (
        node === document.body ||
        node === document.documentElement ||
        !scrollsVertically(node)
      ) {
        continue;
      }
      const area = visibleArea(node);
      if (area > bestArea) {
        best = node;
        bestArea = area;
      }
    }
  }
  return best;
}

/** The page's scroll root, kept while it stays in the page. */
export interface ScrollRoots {
  /** Kept while it stays in the page and the document still does not scroll; looked for again otherwise, and on every new view. */
  current(): Element | null;
  /** A new view: look for the scroll root again. */
  forget(): void;
}

export function createScrollRoots(): ScrollRoots {
  let element: Element | null = null;
  return {
    current() {
      if (!element || !element.isConnected || documentScrolls()) {
        element = findScrollRoot();
      }
      return element;
    },
    forget() {
      element = null;
    },
  };
}
