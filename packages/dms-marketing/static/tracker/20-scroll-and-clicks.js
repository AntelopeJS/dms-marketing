  // --- Scroll root (see the header) ----------------------------------------

  function documentScrolls() {
    const root = document.documentElement;
    return root.scrollHeight - root.clientHeight > 1;
  }

  function scrollsVertically(element) {
    if (element.scrollHeight - element.clientHeight <= 1) {
      return false;
    }
    const overflow = getComputedStyle(element).overflowY;
    return overflow === "auto" || overflow === "scroll";
  }

  /** Area of the element's box inside the window. */
  function visibleArea(element) {
    const box = element.getBoundingClientRect();
    const width = Math.min(box.right, innerWidth) - Math.max(box.left, 0);
    const height = Math.min(box.bottom, innerHeight) - Math.max(box.top, 0);
    return width > 0 && height > 0 ? width * height : 0;
  }

  /**
   * The element scrolling the page, or null when it is the document. Found
   * from what lies under a few points of the window, never by walking the
   * whole tree: a container covering most of the window holds them.
   */
  function findScrollRoot() {
    if (documentScrolls()) {
      return null;
    }
    const marked = document.querySelector(`[${SCROLL_ROOT_ATTRIBUTE}]`);
    if (marked) {
      return marked;
    }
    if (typeof document.elementFromPoint !== "function") {
      return null;
    }
    const visited = new Set();
    let best = null;
    let bestArea = innerWidth * innerHeight * SCROLL_ROOT_COVERAGE;
    for (const [fx, fy] of SCROLL_ROOT_PROBES) {
      let node = document.elementFromPoint(innerWidth * fx, innerHeight * fy);
      // An ancestor already visited was checked with all of its own.
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

  /** Kept while it stays in the page and the document still does not
   * scroll; looked for again otherwise — and on every new view. */
  let scrollRootElement = null;

  function scrollRoot() {
    if (
      !scrollRootElement ||
      !scrollRootElement.isConnected ||
      documentScrolls()
    ) {
      scrollRootElement = findScrollRoot();
    }
    return scrollRootElement;
  }

  // --- Scroll depth (max reached per page, flushed on leave) ----------------

  function currentScrollDepth() {
    const inner = scrollRoot();
    const root = inner || document.documentElement;
    const scrollable = root.scrollHeight - root.clientHeight;
    if (scrollable <= 0) {
      return PERCENT_SCALE;
    }
    const scrolled = inner
      ? inner.scrollTop
      : root.scrollTop || document.body.scrollTop || 0;
    return Math.min(
      PERCENT_SCALE,
      Math.round((scrolled / scrollable) * PERCENT_SCALE),
    );
  }

  function measureScrollDepth() {
    const depth = currentScrollDepth();
    if (depth > maxScrollDepth) {
      maxScrollDepth = depth;
    }
  }

  // Captured on the document: an element's scroll does not bubble, and the
  // window never hears it.
  document.addEventListener("scroll", measureScrollDepth, {
    capture: true,
    passive: true,
  });

  /**
   * Every sampled view reports a depth, scrolled or not: what shows without
   * scrolling is reached too (all of a page shorter than the window), and a
   * view that never scrolls belongs in the denominator.
   */
  function scheduleScrollMeasure() {
    if (document.readyState === "complete") {
      setTimeout(measureScrollDepth, SCROLL_MEASURE_DELAY_MS);
      return;
    }
    window.addEventListener("load", measureScrollDepth, { once: true });
  }

  function flushScrollDepth() {
    if (!heatmapSampled || maxScrollDepth < 0) {
      return;
    }
    enqueue(
      Object.assign(base(), {
        kind: "scroll",
        url: scrolledUrl || currentUrl(),
        data: { depth: maxScrollDepth },
      }),
    );
    maxScrollDepth = -1;
  }

  // --- Click capture (sampled, viewport-normalized) -------------------------

  function shortSelector(element) {
    const parts = [];
    let node = element;
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

  function rounded(value) {
    return Number(
      Math.min(Math.max(value, 0), 1).toFixed(COORDINATE_PRECISION),
    );
  }

  function normalized(value, total) {
    return total <= 0 ? 0 : rounded(value / total);
  }

  /**
   * Where the click landed inside the element it hit, so the point survives
   * being read back at another window size. Document fractions do not: they
   * divide by `scrollHeight`, which on a page shorter than the window IS the
   * window, and the same button then stores a different fraction per visitor.
   *
   * The document itself is excluded — its box is the viewport, so anchoring
   * to it would carry the very dependency being escaped, at the cost of a
   * lookup. Those clicks keep the document fractions alone.
   *
   * `nth` disambiguates: `shortSelector` stops at three levels and can match
   * several elements, and the embedder resolving it would otherwise land on
   * whichever comes first in the document.
   */
  function elementAnchor(target, point) {
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
    let matches;
    try {
      matches = document.querySelectorAll(selector);
    } catch {
      // A class containing CSS-significant characters can produce a selector
      // that never parses; the click is still worth its document fractions.
      return null;
    }
    const nth = Array.prototype.indexOf.call(matches, target);
    if (nth < 0) {
      return null;
    }
    return {
      selector: selector,
      ox: rounded((point.clientX - box.left) / box.width),
      oy: rounded((point.clientY - box.top) / box.height),
      nth: nth,
    };
  }

  /**
   * Where the click happened. A click from the keyboard (Enter, Space) has no
   * pointer — detail 0, coordinates 0,0 — and is placed at the centre of the
   * element it activated instead of the window's corner.
   */
  function clickPoint(target, event) {
    if (event.detail !== 0 || event.clientX !== 0 || event.clientY !== 0) {
      return event;
    }
    const box = target.getBoundingClientRect();
    const clientX = box.left + box.width * ELEMENT_CENTER;
    const clientY = box.top + box.height * ELEMENT_CENTER;
    return {
      clientX: clientX,
      clientY: clientY,
      pageX: clientX + scrollX,
      pageY: clientY + scrollY,
    };
  }

  /**
   * Vertical position of a point in the page's content, and the content's
   * height: with an inner scroll root, the range it hides is unrolled — a
   * click on something inside it moves down by its scroll offset, one on
   * something under it (a footer below the panel) by the whole hidden range
   * — so `dy` reads the same however far the visitor had scrolled it, and
   * lines up with a capture of the whole page. Beside it (a sidebar) or
   * above it (a header), nothing moves.
   */
  function contentPosition(target, point) {
    const height = document.documentElement.scrollHeight;
    const root = scrollRoot();
    if (!root) {
      return { y: point.pageY, height: height };
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
    return { y: y, height: height + hidden };
  }

  document.addEventListener(
    "click",
    (event) => {
      // Script-dispatched clicks (element.click()) are no visitor's.
      if (!heatmapSampled || !event.isTrusted) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const doc = document.documentElement;
      const point = clickPoint(target, event);
      const content = contentPosition(target, point);
      enqueue(
        Object.assign(base(), {
          kind: "click",
          data: Object.assign(
            {
              x: normalized(point.clientX, innerWidth),
              y: normalized(point.clientY, innerHeight),
              dx: normalized(point.pageX, doc.scrollWidth),
              dy: normalized(content.y, content.height),
              selector: shortSelector(target),
            },
            elementAnchor(target, point),
          ),
        }),
      );
    },
    { capture: true, passive: true },
  );

