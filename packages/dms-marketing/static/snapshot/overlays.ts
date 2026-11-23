/** The computed `position` of an element. */
export type PositionOf = (element: Element) => string;

/** Roles of the overlays a visit opens over the page, dropped when they float over it. */
const OVERLAY_ROLES = new Set([
  "dialog",
  "alertdialog",
  "tooltip",
  "menu",
  "listbox",
]);
const LIVE_ROLES = new Set(["status", "alert", "log"]);
const LIVE_POLITENESS = new Set(["polite", "assertive"]);

/** Lists a toast viewport stacks its toasts in. */
const LIST_TAGS = new Set(["ol", "ul"]);

/** In the top layer: a modal `<dialog>`, an open popover. */
const TOP_LAYER_SELECTOR = ":modal, :popover-open";

function isOneOf(tokens: ReadonlySet<string>, value: string | null): boolean {
  return value !== null && tokens.has(value);
}

function isOutOfFlow(position: string): boolean {
  return position === "fixed" || position === "absolute";
}

function inTopLayer(element: Element): boolean {
  try {
    return element.matches(TOP_LAYER_SELECTOR);
  } catch {
    return false;
  }
}

/**
 * A portal: the nearest positioned ancestor is fixed and hangs off `body`,
 * where floating menus and popovers are mounted, unlike a fixed header, which
 * lives in the app's own tree.
 */
function inFloatingPortal(
  element: Element,
  positionOf: PositionOf,
  body: Element,
): boolean {
  for (
    let node = element.parentElement;
    node && node !== body;
    node = node.parentElement
  ) {
    const position = positionOf(node);
    if (position !== "static") {
      return position === "fixed" && node.parentElement === body;
    }
  }
  return false;
}

function isLive(element: Element): boolean {
  return (
    isOneOf(LIVE_ROLES, element.getAttribute("role")) ||
    isOneOf(LIVE_POLITENESS, element.getAttribute("aria-live"))
  );
}

function stacksFixedList(element: Element, positionOf: PositionOf): boolean {
  for (const child of element.children) {
    if (LIST_TAGS.has(child.localName) && positionOf(child) === "fixed") {
      return true;
    }
  }
  return false;
}

/**
 * An overlay the visit opened over the page, not part of it:
 * - anything in the top layer (a modal `<dialog>`, an open popover);
 * - a dialog, alert dialog, tooltip, menu or listbox positioned out of the
 *   flow, or mounted in a fixed portal under `body`;
 * - a live region (role status, alert or log, `aria-live`) fixed to the
 *   viewport: a toast, a notification;
 * - a toast viewport: an element whose list child is fixed and holds the
 *   toasts (Reka / Nuxt UI, Radix, Sonner).
 *
 * In-flow content stays whatever its role: an inline `role="status"` badge, a
 * listbox in a form, a menu in the page's own navigation.
 */
export function isTransientOverlay(
  element: Element,
  positionOf: PositionOf,
  body: Element,
): boolean {
  if (inTopLayer(element)) {
    return true;
  }
  if (isOneOf(OVERLAY_ROLES, element.getAttribute("role"))) {
    return (
      isOutOfFlow(positionOf(element)) ||
      inFloatingPortal(element, positionOf, body)
    );
  }
  const live = isLive(element);
  if (live && positionOf(element) === "fixed") {
    return true;
  }
  if (!live && element.getAttribute("role") !== "region") {
    return false;
  }
  return stacksFixedList(element, positionOf);
}
