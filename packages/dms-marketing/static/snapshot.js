/**
 * dms-marketing page snapshot capture.
 *
 * Served by GET /api/marketing/snapshot.js to a sampled visit the backend
 * wants a capture from (see static/tracker.js), with the site's settings
 * prepended as `window.__dmsMarketingSnapshotConfig` and the tracker's
 * context waiting in `window.__dmsMarketingSnapshotContext`. Serializes the
 * rendered DOM — what the visitor sees, whatever built it — into one
 * self-contained HTML document and uploads it as the heatmap's backdrop.
 *
 * Privacy, unconditionally: no form value, hidden input, script, event
 * handler or framed document leaves the page. `contenteditable` text is
 * masked, as is everything under `data-dms-marketing-mask` (or the
 * `dms-marketing-mask` class); `data-dms-marketing-block` (or the
 * `dms-marketing-block` class) replaces an element with an empty box of its
 * size. `maskText` masks every text node.
 */
(() => {
  const CONFIG_GLOBAL = "__dmsMarketingSnapshotConfig";
  const CONTEXT_GLOBAL = "__dmsMarketingSnapshotContext";
  const MASK_MARKER = "dms-marketing-mask";
  const BLOCK_MARKER = "dms-marketing-block";
  const MASK_CHAR = "x";
  /** Mirrors the backend MAX_URL_LENGTH. */
  const MAX_URL_LENGTH = 500;
  const MAX_REPORTED_BYTES = 256 * 1024 * 1024;
  /** A canvas past this many data-URL characters ships empty. */
  const MAX_CANVAS_DATA_URL_LENGTH = 200000;
  /** Time without a DOM mutation before the page counts as settled. */
  const QUIET_MS = 500;
  const QUIET_DEADLINE_MS = 10000;
  const IDLE_TIMEOUT_MS = 2000;

  const VOID_TAGS = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);
  /** Nothing of theirs renders in a script-less document — noscript
   * included, whose content WOULD render there — or their content is another
   * document, plugin or stream. */
  const DROPPED_TAGS = new Set([
    "script",
    "noscript",
    "template",
    "meta",
    "base",
    "object",
    "embed",
    "applet",
    "portal",
    "source",
    "track",
  ]);
  const DROPPED_ATTRIBUTES = new Set([
    "srcdoc",
    "nonce",
    "integrity",
    "action",
    "formaction",
    "ping",
  ]);
  /** Media and frames keep their box, never their content. */
  const SOURCELESS_TAGS = new Set(["iframe", "frame", "video", "audio"]);
  const URL_ATTRIBUTES = new Set([
    "src",
    "href",
    "poster",
    "xlink:href",
    "background",
  ]);
  const LINK_TAGS = new Set(["a", "area"]);
  const OPAQUE_URL_PATTERN = /^(#|data:|blob:|about:)/i;
  const SCRIPT_URL_PATTERN = /^javascript:/i;
  const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]*)\1\s*\)/g;
  const CSS_IMPORT_PATTERN = /@import\s+(['"])([^'"]+)\1/g;

  function readGlobal(name) {
    const value = window[name];
    delete window[name];
    return value && typeof value === "object" ? value : null;
  }

  const config = readGlobal(CONFIG_GLOBAL);
  const context = readGlobal(CONTEXT_GLOBAL);
  if (
    !config ||
    !context ||
    typeof context.endpoint !== "string" ||
    window.top !== window
  ) {
    return;
  }

  // --- Text -----------------------------------------------------------------

  function escapeText(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function escapeAttribute(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  /** Whitespace survives so lines still wrap where they did. */
  function maskText(text) {
    return text.replace(/\S/g, MASK_CHAR);
  }

  // --- URLs -----------------------------------------------------------------

  /** Absolute form, untouched for fragments and inline data, null for what
   * must not be carried (script URLs, garbage). */
  function absoluteUrl(value, base) {
    const trimmed = value.trim();
    if (!trimmed || OPAQUE_URL_PATTERN.test(trimmed)) {
      return trimmed;
    }
    if (SCRIPT_URL_PATTERN.test(trimmed)) {
      return null;
    }
    try {
      return new URL(trimmed, base).href;
    } catch {
      return null;
    }
  }

  /** Links keep their target, never a query or fragment: tokens and
   * addresses ride there, and nothing in the backdrop is clickable. */
  function withoutQuery(url) {
    try {
      const parsed = new URL(url);
      parsed.search = "";
      parsed.hash = "";
      return parsed.href;
    } catch {
      return url;
    }
  }

  function absolutizeSrcset(value, base) {
    return value
      .split(",")
      .map((candidate) => {
        const [url, ...descriptors] = candidate.trim().split(/\s+/);
        const absolute = url ? absoluteUrl(url, base) : null;
        return absolute ? [absolute, ...descriptors].join(" ") : "";
      })
      .filter(Boolean)
      .join(", ");
  }

  function absolutizeCss(css, base) {
    return css
      .replace(CSS_URL_PATTERN, (_match, _quote, url) => {
        const absolute = absoluteUrl(url, base);
        return absolute === null ? "url()" : `url(${JSON.stringify(absolute)})`;
      })
      .replace(CSS_IMPORT_PATTERN, (match, _quote, url) => {
        const absolute = absoluteUrl(url, base);
        return absolute === null
          ? match
          : `@import ${JSON.stringify(absolute)}`;
      });
  }

  // --- Stylesheets ----------------------------------------------------------

  /**
   * Rules read from the CSSOM, not from the element's text: CSS-in-JS
   * libraries insert theirs with `insertRule`, leaving the `<style>` empty.
   * Null when the browser refuses (cross-origin sheet); the caller keeps a
   * link then. Readable imports are inlined in place, under their media.
   */
  function rulesText(sheet, base) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      return null;
    }
    let out = "";
    for (const rule of rules) {
      const imported =
        rule.type === CSSRule.IMPORT_RULE && rule.styleSheet
          ? rulesText(rule.styleSheet, rule.styleSheet.href || base)
          : null;
      if (imported === null) {
        out += `${absolutizeCss(rule.cssText, base)}\n`;
        continue;
      }
      const media = rule.media?.mediaText;
      out += media ? `@media ${media}{${imported}}\n` : `${imported}\n`;
    }
    return out;
  }

  function mediaAttribute(element) {
    const media = element.getAttribute("media");
    return media ? ` media="${escapeAttribute(media)}"` : "";
  }

  function serializeStyle(element) {
    const sheet = element.sheet;
    if (sheet?.disabled) {
      return "";
    }
    const css = sheet ? rulesText(sheet, location.href) : null;
    const text = css === null ? element.textContent : css;
    return `<style${mediaAttribute(element)}>${text}</style>`;
  }

  /** Only stylesheets render; preloads, icons and manifests are requests
   * the backdrop has no use for. */
  function serializeLink(element) {
    const rel = (element.getAttribute("rel") || "").toLowerCase().split(/\s+/);
    const sheet = element.sheet;
    if (!rel.includes("stylesheet") || sheet?.disabled) {
      return "";
    }
    const href = element.href;
    const css = sheet ? rulesText(sheet, href) : null;
    if (css !== null) {
      return `<style${mediaAttribute(element)}>${css}</style>`;
    }
    return `<link rel="stylesheet" href="${escapeAttribute(href)}"${mediaAttribute(element)}>`;
  }

  function adoptedStyles(root) {
    let out = "";
    for (const sheet of root.adoptedStyleSheets || []) {
      out += `<style>${rulesText(sheet, location.href) || ""}</style>`;
    }
    return out;
  }

  // --- Elements -------------------------------------------------------------

  function isMarked(element, marker) {
    return (
      element.hasAttribute(`data-${marker}`) ||
      element.classList.contains(marker)
    );
  }

  function imageSource(element, value) {
    const current = element.currentSrc;
    if (current && !current.startsWith("data:")) {
      return current;
    }
    return element.dataset.src || current || value;
  }

  function serializeAttributes(element) {
    const tag = element.localName;
    let out = "";
    for (const attribute of element.attributes) {
      const name = attribute.name;
      let value = attribute.value;
      if (name.startsWith("on") || DROPPED_ATTRIBUTES.has(name)) {
        continue;
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
        value = LINK_TAGS.has(tag) ? withoutQuery(absolute) : absolute;
      }
      out += ` ${name}="${escapeAttribute(value)}"`;
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

  function serializeCanvas(element) {
    let dataUrl = "";
    try {
      dataUrl = element.toDataURL();
    } catch {
      // Tainted by cross-origin drawing: the box stays, the pixels do not.
    }
    if (dataUrl && dataUrl.length <= MAX_CANVAS_DATA_URL_LENGTH) {
      return `<img${serializeAttributes(element)} src="${dataUrl}">`;
    }
    return `<canvas${serializeAttributes(element)}></canvas>`;
  }

  function serializeChildren(node, masked) {
    let out = "";
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        out += serializeElement(child, masked);
      } else if (child.nodeType === Node.TEXT_NODE) {
        const text = masked ? maskText(child.data) : child.data;
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
    if (tag === "canvas") {
      return serializeCanvas(element);
    }
    const mask =
      masked || isMarked(element, MASK_MARKER) || element.isContentEditable;
    let out = `<${tag}${serializeAttributes(element)}>`;
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
    return `<!DOCTYPE html>${serializeElement(document.documentElement, config.maskText === true)}`;
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

  // text/plain is CORS-safelisted (no preflight); no-cors keeps the
  // unreadable answer from logging an error on the visitor's console.
  function post(body) {
    fetch(context.endpoint, {
      method: "POST",
      body,
      mode: "no-cors",
      credentials: "omit",
    }).catch(() => {});
  }

  function capture() {
    // The visitor navigated on since the negotiation: this is another page.
    if (location.pathname !== context.path) {
      return;
    }
    const root = document.documentElement;
    const page = {
      website: context.website,
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
      document: { width: root.scrollWidth, height: root.scrollHeight },
      html,
    });
    if (new Blob([body]).size <= config.maxBytes) {
      post(body);
      return;
    }
    post(
      JSON.stringify({
        ...page,
        oversizeBytes: Math.min(new Blob([html]).size, MAX_REPORTED_BYTES),
      }),
    );
  }

  whenSettled(() => whenIdle(capture));
})();
