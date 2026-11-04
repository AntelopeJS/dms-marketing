  // --- Elements -------------------------------------------------------------

  function isMarked(element, marker) {
    return (
      element.hasAttribute(`data-${marker}`) ||
      element.classList.contains(marker)
    );
  }

  function isOutOfFlow(position) {
    return position === "fixed" || position === "absolute";
  }

  function inTopLayer(element) {
    try {
      return element.matches(TOP_LAYER_SELECTOR);
    } catch {
      // A browser without one of the pseudo-classes has no such layer.
      return false;
    }
  }

  /** A portal: the nearest positioned ancestor is fixed and hangs off
   * `body` — where floating menus and popovers are mounted, unlike a fixed
   * header, which lives in the app's own tree. */
  function inFloatingPortal(element, positionOf, body) {
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

  function isLive(element) {
    return (
      LIVE_ROLES.has(element.getAttribute("role")) ||
      LIVE_POLITENESS.has(element.getAttribute("aria-live"))
    );
  }

  /**
   * An overlay the visit opened over the page, not part of it:
   * - anything in the top layer (a modal `<dialog>`, an open popover);
   * - a dialog, alert dialog, tooltip, menu or listbox positioned out of
   *   the flow, or mounted in a fixed portal under `body`;
   * - a live region (role status, alert or log, `aria-live`) fixed to the
   *   viewport: a toast, a notification;
   * - a toast viewport: an element whose list child is fixed and holds the
   *   toasts (Reka / Nuxt UI, Radix, Sonner).
   * In-flow content stays whatever its role: an inline `role="status"`
   * badge, a listbox in a form, a menu in the page's own navigation.
   * `positionOf` is the computed `position` of an element.
   */
  function isTransientOverlay(element, positionOf, body) {
    if (inTopLayer(element)) {
      return true;
    }
    if (OVERLAY_ROLES.has(element.getAttribute("role"))) {
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
    for (const child of element.children) {
      if (LIST_TAGS.has(child.localName) && positionOf(child) === "fixed") {
        return true;
      }
    }
    return false;
  }

  function computedPosition(element) {
    return getComputedStyle(element).position;
  }

  function imageSource(element, value) {
    const current = element.currentSrc;
    if (current && !current.startsWith("data:")) {
      return current;
    }
    return element.dataset.src || current || value;
  }

  function serializeAttributes(element, masked) {
    const tag = element.localName;
    let out = "";
    for (const attribute of element.attributes) {
      const name = attribute.name;
      let value = attribute.value;
      if (name.startsWith("on") || DROPPED_ATTRIBUTES.has(name)) {
        continue;
      }
      if (
        ((masked || maskAllText) && TEXT_ATTRIBUTES.has(name)) ||
        (masked &&
          name.startsWith("data-") &&
          !name.startsWith(`data-${MASK_MARKER}`))
      ) {
        value = maskText(value);
      }
      if (name === "value" && (tag === "input" || tag === "textarea")) {
        continue;
      }
      if (
        (name === "checked" && tag === "input") ||
        (name === "selected" && tag === "option")
      ) {
        continue;
      }
      if (name === "src" && SOURCELESS_TAGS.has(tag)) {
        continue;
      }
      if (
        tag === "img" &&
        element.currentSrc &&
        (name === "srcset" || name === "sizes")
      ) {
        continue;
      }
      if (name === "src" && tag === "img") {
        value = imageSource(element, value);
      }
      if (name === "srcset") {
        value = absolutizeSrcset(value, location.href);
      } else if (name === "style") {
        value = absolutizeCss(value, location.href);
      } else if (URL_ATTRIBUTES.has(name)) {
        const absolute = absoluteUrl(value, location.href);
        if (absolute === null) {
          continue;
        }
        value = LINK_TAGS.has(tag) ? withoutQuery(absolute, masked) : absolute;
      }
      if (value.includes("var(")) {
        styles.noteVariables(value);
      }
      out += ` ${name}="${escapeAttribute(value)}"`;
    }
    if (
      element === scrollRootElement &&
      !element.hasAttribute(SCROLL_ROOT_ATTRIBUTE)
    ) {
      out += ` ${SCROLL_ROOT_ATTRIBUTE}=""`;
    }
    return out;
  }

  /** The element's own box, nothing inside it. Id and class stay so the
   * page's CSS still lays it out — and click anchors still resolve to it.
   * The box is the border box the visitor saw, capped at its container so a
   * narrower layout reflows it instead of overflowing. */
  function serializeBlocked(element) {
    const box = element.getBoundingClientRect();
    const tag = VOID_TAGS.has(element.localName) ? "span" : element.localName;
    let attributes = "";
    for (const name of ["id", "class"]) {
      const value = element.getAttribute(name);
      if (value) {
        attributes += ` ${name}="${escapeAttribute(value)}"`;
      }
    }
    const size = `box-sizing:border-box;width:${Math.round(box.width)}px;max-width:100%;height:${Math.round(box.height)}px`;
    return `<${tag}${attributes} style="${size};overflow:hidden"></${tag}>`;
  }

  function serializeCanvas(element, masked) {
    let dataUrl = "";
    try {
      dataUrl = element.toDataURL();
    } catch {
      // Tainted by cross-origin drawing: the box stays, the pixels do not.
    }
    if (dataUrl && dataUrl.length <= MAX_CANVAS_DATA_URL_LENGTH) {
      return `<img${serializeAttributes(element, masked)} src="${dataUrl}">`;
    }
    return `<canvas${serializeAttributes(element, masked)}></canvas>`;
  }

  function serializeChildren(node, masked) {
    let out = "";
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        out += serializeElement(child, masked);
      } else if (child.nodeType === Node.TEXT_NODE) {
        const text =
          masked || maskAllText ? maskText(child.data) : child.data;
        out += escapeText(text);
      }
    }
    return out;
  }

  function serializeElement(element, masked) {
    const tag = element.localName;
    if (
      DROPPED_TAGS.has(tag) ||
      (tag === "input" && element.type === "hidden")
    ) {
      return "";
    }
    if (tag === "style") {
      return serializeStyle(element);
    }
    if (tag === "link") {
      return serializeLink(element);
    }
    if (isMarked(element, BLOCK_MARKER)) {
      return serializeBlocked(element);
    }
    if (isTransientOverlay(element, computedPosition, document.body)) {
      return "";
    }
    const mask =
      masked || isMarked(element, MASK_MARKER) || element.isContentEditable;
    if (tag === "canvas") {
      return serializeCanvas(element, mask);
    }
    let out = `<${tag}${serializeAttributes(element, mask)}>`;
    if (VOID_TAGS.has(tag)) {
      return out;
    }
    // A textarea's text IS its value.
    if (tag !== "textarea") {
      if (element.shadowRoot) {
        out += `<template shadowrootmode="open">${adoptedStyles(element.shadowRoot)}${serializeChildren(element.shadowRoot, mask)}</template>`;
      }
      if (tag === "head") {
        out += '<meta charset="utf-8">';
      }
      out += serializeChildren(element, mask);
      if (tag === "head") {
        out += adoptedStyles(document);
      }
    }
    return `${out}</${tag}>`;
  }

  function serializeDocument() {
    styles = createStyleCollector();
    pendingSheets = [];
    placeholderNonce = Math.random().toString(36).slice(2);
    const html = `<!DOCTYPE html>${serializeElement(document.documentElement, false)}`;
    const css = styles.finish(pendingSheets.map((sheet) => sheet.segments));
    const marker = new RegExp(
      `<!--dms-marketing-sheet-${placeholderNonce}-([0-9]+)-->`,
      "g",
    );
    const out = html.replace(marker, (_match, index) =>
      css[index]
        ? `<style${pendingSheets[index].media}>${styleText(css[index])}</style>`
        : "",
    );
    styles = null;
    pendingSheets = [];
    return out;
  }

  // --- Timing ---------------------------------------------------------------

  /** Calls back once the DOM has stopped mutating, or at the deadline on a
   * page that never stops (a ticking clock, a looping animation). */
  function whenSettled(callback) {
    let done = false;
    let timer = null;
    const observer = new MutationObserver(arm);
    function finish() {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timer);
      observer.disconnect();
      callback();
    }
    function arm() {
      clearTimeout(timer);
      timer = setTimeout(finish, QUIET_MS);
    }
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    arm();
    setTimeout(finish, QUIET_DEADLINE_MS);
  }

  function whenIdle(callback) {
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
      return;
    }
    setTimeout(callback, 0);
  }

  // --- Upload ---------------------------------------------------------------

  /** Gzipped where the browser can (the backend recognizes the gzip
   * header), null otherwise: the upload then goes as plain JSON. */
  async function gzip(text) {
    if (typeof CompressionStream !== "function") {
      return null;
    }
    try {
      const stream = new Blob([text])
        .stream()
        .pipeThrough(new CompressionStream("gzip"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      return null;
    }
  }

  // text/plain is CORS-safelisted (no preflight), compressed or not; no-cors
  // keeps the unreadable answer from logging an error on the visitor's
  // console.
  function post(body) {
    fetch(context.endpoint, {
      method: "POST",
      body,
      mode: "no-cors",
      credentials: "omit",
    }).catch(() => {});
  }

  /** The tracker's detection; a tracker older than this script has none,
   * and the document is taken as scrolling. */
  function findScrollRoot() {
    try {
      return typeof context.scrollRoot === "function"
        ? context.scrollRoot() || null
        : null;
    } catch {
      return null;
    }
  }

  /** The whole content: the document, plus what the scroll root hides. */
  function contentSize(root, scrollRoot) {
    const hidden = scrollRoot
      ? Math.max(scrollRoot.scrollHeight - scrollRoot.clientHeight, 0)
      : 0;
    return { width: root.scrollWidth, height: root.scrollHeight + hidden };
  }

  async function capture() {
    // The visitor navigated on since the negotiation: this is another page.
    if (location.pathname !== context.path) {
      return;
    }
    const root = document.documentElement;
    scrollRootElement = findScrollRoot();
    const page = {
      website: context.website,
      token: config.token,
      url: (location.origin + location.pathname + location.search).slice(
        0,
        MAX_URL_LENGTH,
      ),
      viewport: { width: innerWidth, height: innerHeight },
      colorScheme: matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light",
    };
    const html = serializeDocument();
    const body = JSON.stringify({
      ...page,
      document: contentSize(root, scrollRootElement),
      html,
    });
    scrollRootElement = null;
    // The cap applies to what travels: the compressed upload when there is
    // one.
    const compressed = await gzip(body);
    const size = compressed ? compressed.byteLength : new Blob([body]).size;
    if (size <= config.maxBytes) {
      post(
        compressed ? new Blob([compressed], { type: "text/plain" }) : body,
      );
      return;
    }
    post(
      JSON.stringify({
        ...page,
        oversizeBytes: Math.min(size, MAX_REPORTED_BYTES),
      }),
    );
  }

  if (isModule) {
    module.exports = {
      contentSize,
      createStyleCollector,
      isTransientOverlay,
      splitSelectorList,
      styleText,
      testedSelector,
    };
  } else if (asked) {
    whenSettled(() => whenIdle(() => void capture().catch(() => {})));
  }
})();
