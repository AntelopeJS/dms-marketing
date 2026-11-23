import { type Outbox, eventBase } from "./outbox";
import type { ScrollRoots } from "./scroll-root";
import type { TrackerSession } from "./session";

const MAX_SELECTOR_LENGTH = 120;
const SELECTOR_DEPTH = 3;
const COORDINATE_PRECISION = 4;

/** Where a keyboard-activated click is anchored inside its element. */
const ELEMENT_CENTER = 0.5;

/** Where a click happened, in the window and in the document. */
interface ClickPoint {
  readonly clientX: number;
  readonly clientY: number;
  readonly pageX: number;
  readonly pageY: number;
}

/** Where a click landed inside the element it hit. */
interface ElementAnchor {
  readonly selector: string;
  readonly ox: number;
  readonly oy: number;
  readonly nth: number;
}

function shortSelector(element: Element): string {
  const parts: string[] = [];
  let node: Element | null = element;
  for (let depth = 0; node && depth < SELECTOR_DEPTH; depth++) {
    if (node.id) {
      parts.unshift(`#${node.id}`);
      break;
    }
    const classes = Array.from(node.classList).slice(0, 2).join(".");
    parts.unshift(classes ? `${node.localName}.${classes}` : node.localName);
    node = node.parentElement;
  }
  return parts.join(">").slice(0, MAX_SELECTOR_LENGTH);
}

function rounded(value: number): number {
  return Number(Math.min(Math.max(value, 0), 1).toFixed(COORDINATE_PRECISION));
}

function normalized(value: number, total: number): number {
  return total <= 0 ? 0 : rounded(value / total);
}

/**
 * Where the click landed inside the element it hit, so the point survives
 * being read back at another window size. Document fractions do not: they
 * divide by `scrollHeight`, which on a page shorter than the window IS the
 * window, and the same button then stores a different fraction per visitor.
 *
 * The document itself is excluded: its box is the viewport, so anchoring to
 * it would carry the very dependency being escaped, at the cost of a
 * lookup. Those clicks keep the document fractions alone.
 *
 * `nth` disambiguates: `shortSelector` stops at three levels and can match
 * several elements, and the embedder resolving it would otherwise land on
 * whichever comes first in the document.
 */
function elementAnchor(
  target: Element,
  point: ClickPoint,
): ElementAnchor | null {
  if (target === document.body || target === document.documentElement) {
    return null;
  }
  const selector = shortSelector(target);
  if (!selector) {
    return null;
  }
  const box = target.getBoundingClientRect();
  if (box.width <= 0 || box.height <= 0) {
    return null;
  }
  let matches: Element[];
  try {
    matches = Array.from(document.querySelectorAll(selector));
  } catch {
    return null;
  }
  const nth = matches.indexOf(target);
  if (nth < 0) {
    return null;
  }
  return {
    selector,
    ox: rounded((point.clientX - box.left) / box.width),
    oy: rounded((point.clientY - box.top) / box.height),
    nth,
  };
}

/**
 * Where the click happened. A click from the keyboard (Enter, Space) has no
 * pointer, detail 0 and coordinates 0,0, and is placed at the centre of the
 * element it activated instead of the window's corner.
 */
function clickPoint(target: Element, event: MouseEvent): ClickPoint {
  if (event.detail !== 0 || event.clientX !== 0 || event.clientY !== 0) {
    return event;
  }
  const box = target.getBoundingClientRect();
  const clientX = box.left + box.width * ELEMENT_CENTER;
  const clientY = box.top + box.height * ELEMENT_CENTER;
  return {
    clientX,
    clientY,
    pageX: clientX + scrollX,
    pageY: clientY + scrollY,
  };
}

/** A point's vertical position in the page's content, and the content's height. */
interface ContentPosition {
  readonly y: number;
  readonly height: number;
}

/**
 * Vertical position of a point in the page's content, and the content's
 * height: with an inner scroll root, the range it hides is unrolled. A click
 * on something inside it moves down by its scroll offset, one on something
 * under it (a footer below the panel) by the whole hidden range, so `dy`
 * reads the same however far the visitor had scrolled it, and lines up with
 * a capture of the whole page. Beside it (a sidebar) or above it (a header),
 * nothing moves.
 */
function contentPosition(
  target: Element,
  point: ClickPoint,
  scrollRoots: ScrollRoots,
): ContentPosition {
  const height = document.documentElement.scrollHeight;
  const root = scrollRoots.current();
  if (!root) {
    return { y: point.pageY, height };
  }
  const hidden = root.scrollHeight - root.clientHeight;
  let y = point.pageY;
  if (root.contains(target)) {
    y += root.scrollTop;
  } else {
    const box = root.getBoundingClientRect();
    if (
      point.clientY >= box.bottom &&
      point.clientX >= box.left &&
      point.clientX < box.right
    ) {
      y += hidden;
    }
  }
  return { y, height: height + hidden };
}

/** Records the sampled, viewport-normalized clicks of the visitor. */
export function installClickCapture(
  session: TrackerSession,
  outbox: Outbox,
  scrollRoots: ScrollRoots,
): void {
  document.addEventListener(
    "click",
    (event) => {
      if (!session.heatmapSampled || !event.isTrusted) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const doc = document.documentElement;
      const point = clickPoint(target, event);
      const content = contentPosition(target, point, scrollRoots);
      outbox.enqueue({
        ...eventBase(),
        kind: "click",
        data: {
          x: normalized(point.clientX, innerWidth),
          y: normalized(point.clientY, innerHeight),
          dx: normalized(point.pageX, doc.scrollWidth),
          dy: normalized(content.y, content.height),
          selector: shortSelector(target),
          ...elementAnchor(target, point),
        },
      });
    },
    { capture: true, passive: true },
  );
}
