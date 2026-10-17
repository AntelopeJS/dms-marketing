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
 * `dms-marketing-mask` class) — text, the attributes that carry text
 * (title, alt, labels, placeholders, data-*) and the path of its links;
 * `data-dms-marketing-block` (or the `dms-marketing-block` class) replaces
 * an element with an empty box of its size. `maskText` masks every text
 * node and text attribute of the page; data-* and link paths stay, since
 * styles select on them.
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
  /** Attributes that carry text a visitor could read, masked with it. */
  const TEXT_ATTRIBUTES = new Set([
    "title",
    "alt",
    "label",
    "placeholder",
    "aria-label",
    "aria-description",
    "aria-placeholder",
    "aria-valuetext",
  ]);
  const OPAQUE_URL_PATTERN = /^(#|data:|blob:|about:)/i;
  const SCRIPT_URL_PATTERN = /^javascript:/i;
  const CSS_URL_PATTERN = /url\(\s*(['"]?)([^'")]*)\1\s*\)/g;
  const CSS_IMPORT_PATTERN = /@import\s+(['"])([^'"]+)\1/g;

  function readGlobal(name) {
    const value = window[name];
    delete window[name];
    return value && typeof value === "object" ? value : null;
  }

  /** Loaded by the module's tests (CommonJS) rather than by a page: the
   * pure parts are exported instead of capturing anything. */
  const isModule =
    typeof window === "undefined" &&
    typeof module === "object" &&
    module !== null;
  const config = isModule ? null : readGlobal(CONFIG_GLOBAL);
  const maskAllText = config?.maskText === true;
  const context = isModule ? null : readGlobal(CONTEXT_GLOBAL);
  const asked =
    !!config &&
    !!context &&
    typeof config.token === "string" &&
    typeof context.endpoint === "string" &&
    window.top === window;

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
   * addresses ride there, and nothing in the backdrop is clickable. A masked
   * link keeps its origin alone — a profile path names its person. */
  function withoutQuery(url, masked) {
    try {
      const parsed = new URL(url);
      if (masked) {
        return `${parsed.origin}/`;
      }
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
  //
  // A page carries far more CSS than it uses — a framework's utilities, a
  // component library, every layer a host app loads — and a capture inlining
  // all of it routinely weighs megabytes. A style rule is kept only when its
  // selector matches an element of the captured document, tested with the
  // states it depends on (hover, focus, open…) and its pseudo-element taken
  // off, so whatever could show in the snapshot keeps its style; a selector
  // the browser cannot test is kept. Custom properties that no kept rule,
  // inline style or kept property value refers to are dropped. Conditional
  // wrappers (@media, @supports, @container…) stay around the rules they
  // still hold — every layout's, not only the visitor's — and @layer blocks
  // stay even empty (their order is the cascade's), as do @font-face,
  // @keyframes, @property and the other at-rules. A stylesheet identical to
  // one already serialized is not repeated.

  const STYLE_RULE = 1;
  const IMPORT_RULE = 3;
  const KEYFRAMES_RULE = 7;
  /** Selectors `querySelector` cannot answer for from the sheet's scope:
   * the rule is kept. */
  const UNTESTABLE_SELECTOR_PATTERN =
    /:host|::slotted|::part|::cue|::highlight|::view-transition|:state\(|&|:scope/;
  /** A pseudo-element renders on its element: the rule is tested on it. */
  const PSEUDO_ELEMENT_PATTERN =
    /::[\w-]+|:(?:before|after|first-line|first-letter)(?![\w-])/g;
  /** States a snapshot may be looked at in, or a visitor's input sets: the
   * rule is tested as if the state held. */
  const STATE_PSEUDO_CLASS_PATTERN =
    /:(?:hover|focus|focus-visible|focus-within|active|visited|link|any-link|target|target-within|checked|indeterminate|placeholder-shown|autofill|valid|invalid|user-valid|user-invalid|in-range|out-of-range|open|closed|popover-open|modal|fullscreen|playing|paused)(?![\w-])/g;
  const COMBINATOR_SPACING_PATTERN = /\s*([>+~])\s*/g;
  /** A compound the stripping above left empty stands for any element. */
  const EMPTY_COMPOUND_PATTERN = /(^|[\s>+~(,])(?=$|[\s>+~),])/g;
  const NEGATED_ANY_PATTERN = /:not\(\*\)/g;
  const ESCAPED_COLON_PATTERN = /\\:/g;
  /** Stands in for an escaped colon while pseudo-classes are stripped. */
  const ESCAPED_COLON_TOKEN = "\u0001";
  const CSS_VARIABLE_PATTERN = /var\(\s*(--[\w-]+)/g;
  const LAYER_PRELUDE_PATTERN = /^@layer\b/;

  /** Selector list split on its top-level commas. */
  function splitSelectorList(list) {
    const parts = [];
    let depth = 0;
    let quote = "";
    let start = 0;
    for (let index = 0; index < list.length; index++) {
      const char = list[index];
      if (quote) {
        if (char === "\\") {
          index++;
        } else if (char === quote) {
          quote = "";
        }
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "(" || char === "[") {
        depth++;
      } else if (char === ")" || char === "]") {
        depth--;
      } else if (char === "," && depth === 0) {
        parts.push(list.slice(start, index).trim());
        start = index + 1;
      }
    }
    parts.push(list.slice(start).trim());
    return parts;
  }

  /** One selector as tested, null when it cannot be (the rule stays). */
  function testedSelector(selector) {
    if (UNTESTABLE_SELECTOR_PATTERN.test(selector)) {
      return null;
    }
    // An escaped colon belongs to a class name (`.md\:hover\:flex`).
    const escaped = selector.replace(ESCAPED_COLON_PATTERN, ESCAPED_COLON_TOKEN);
    const stripped = escaped
      .replace(PSEUDO_ELEMENT_PATTERN, "")
      .replace(STATE_PSEUDO_CLASS_PATTERN, "");
    if (stripped === escaped) {
      return selector;
    }
    // `.a > ::before` → `.a>*`; `.a:not(:hover)` → `.a`, not `.a:not(*)`,
    // which would match nothing.
    return stripped
      .replace(COMBINATOR_SPACING_PATTERN, "$1")
      .trim()
      .replace(EMPTY_COMPOUND_PATTERN, "$1*")
      .replace(NEGATED_ANY_PATTERN, "")
      .replaceAll(ESCAPED_COLON_TOKEN, "\\:");
  }

  function selectorMatches(scope, selector) {
    try {
      return scope.querySelector(selector) !== null;
    } catch {
      // Unknown to this browser's querySelector (a vendor pseudo-class, a
      // newer syntax): it may well match, so it stays.
      return true;
    }
  }

  function cssVariables(text, into) {
    for (const match of text.matchAll(CSS_VARIABLE_PATTERN)) {
      into.add(match[1]);
    }
  }

  /**
   * What the stylesheets of one capture keep, across every sheet and shadow
   * root: custom properties inherit, so a variable one sheet defines another
   * uses. Sheets are read into segments first (strings, or style rules with
   * their custom property declarations set apart), and rendered once every
   * sheet and inline style has said which variables it needs.
   */
  function createStyleCollector() {
    /** Variables referred to outside a custom property's own value. */
    const used = new Set();
    /** Every kept value of each custom property, for the transitive pass. */
    const definitions = new Map();
    /** Per scope (document, shadow root): selector list → applies. */
    const verdicts = new Map();

    function ruleApplies(scope, selectorText) {
      let cache = verdicts.get(scope);
      if (!cache) {
        cache = new Map();
        verdicts.set(scope, cache);
      }
      let applies = cache.get(selectorText);
      if (applies === undefined) {
        applies = splitSelectorList(selectorText).some((part) => {
          const tested = testedSelector(part);
          return tested === null || selectorMatches(scope, tested);
        });
        cache.set(selectorText, applies);
      }
      return applies;
    }

    function keptText(text) {
      cssVariables(text, used);
      return text;
    }

    /** A kept style rule; a declaration whose text cannot be located in
     * the rule's stays in it. */
    function styleRuleSegment(rule, base) {
      const text = absolutizeCss(rule.cssText, base);
      const style = rule.style;
      const declarations = [];
      let rest = text;
      for (let index = 0; index < (style ? style.length : 0); index++) {
        const name = style[index];
        if (!name.startsWith("--")) {
          continue;
        }
        const value = style.getPropertyValue(name);
        const important =
          style.getPropertyPriority(name) === "important" ? " !important" : "";
        const source = `${name}: ${value}${important};`;
        if (!rest.includes(source)) {
          continue;
        }
        rest = rest.replace(source, "");
        declarations.push({ name, source });
        const values = definitions.get(name) || [];
        values.push(value);
        definitions.set(name, values);
      }
      cssVariables(rest, used);
      return declarations.length > 0 ? { text, declarations } : text;
    }

    function ruleListSegments(rules, base, scope) {
      const segments = [];
      for (const rule of rules) {
        segments.push(...ruleSegments(rule, base, scope));
      }
      return segments;
    }

    function ruleSegments(rule, base, scope) {
      if (rule.type === IMPORT_RULE) {
        const imported = rule.styleSheet
          ? sheetSegments(rule.styleSheet, rule.styleSheet.href || base, scope)
          : null;
        if (imported === null) {
          return [keptText(absolutizeCss(rule.cssText, base))];
        }
        const media = rule.media?.mediaText;
        return media ? [`@media ${media}{`, ...imported, "}"] : imported;
      }
      if (rule.type === STYLE_RULE) {
        if (!ruleApplies(scope, rule.selectorText)) {
          // Nested rules included: each one only matches within (or on) an
          // element its parent matches.
          return [];
        }
        // A nested block is not tested rule by rule: it stays whole.
        return rule.cssRules?.length
          ? [keptText(absolutizeCss(rule.cssText, base))]
          : [styleRuleSegment(rule, base)];
      }
      if (rule.cssRules && rule.type !== KEYFRAMES_RULE) {
        // A grouping rule: its prelude is whatever precedes its block.
        const prelude = rule.cssText.slice(0, rule.cssText.indexOf("{"));
        const inner = ruleListSegments(rule.cssRules, base, scope);
        if (inner.length === 0 && !LAYER_PRELUDE_PATTERN.test(prelude)) {
          return [];
        }
        return [`${prelude}{`, ...inner, "}"];
      }
      return [keptText(absolutizeCss(rule.cssText, base))];
    }

    /**
     * The rules of a sheet worth keeping, as segments, tested against
     * `scope` (the document, or the shadow root holding the sheet). Null
     * when the browser refuses to read them (cross-origin sheet): the caller
     * keeps a link then. Rules are read from the CSSOM, not from the
     * element's text: CSS-in-JS libraries insert theirs with `insertRule`,
     * leaving the `<style>` empty. Readable imports are inlined in place,
     * under their media.
     */
    function sheetSegments(sheet, base, scope) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        return null;
      }
      return ruleListSegments(rules, base, scope);
    }

    /** Every variable reachable from what the capture uses. */
    function reachableVariables() {
      const reached = new Set(used);
      const pending = [...used];
      while (pending.length > 0) {
        for (const value of definitions.get(pending.pop()) || []) {
          const found = new Set();
          cssVariables(value, found);
          for (const name of found) {
            if (!reached.has(name)) {
              reached.add(name);
              pending.push(name);
            }
          }
        }
      }
      return reached;
    }

    function render(segments, reached) {
      let out = "";
      for (const segment of segments) {
        if (typeof segment === "string") {
          out += `${segment}\n`;
          continue;
        }
        let text = segment.text;
        for (const declaration of segment.declarations) {
          if (!reached.has(declaration.name)) {
            text = text.replace(declaration.source, "");
          }
        }
        out += `${text}\n`;
      }
      return out;
    }

    return {
      sheetSegments,
      /** Variables an inline style or an attribute refers to. */
      noteVariables: (text) => cssVariables(text, used),
      /** Each sheet's final text; empty for one already rendered. */
      finish(sheets) {
        const reached = reachableVariables();
        const seen = new Set();
        return sheets.map((segments) => {
          const css = render(segments, reached);
          if (seen.has(css)) {
            return "";
          }
          seen.add(css);
          return css;
        });
      },
    };
  }

  function mediaAttribute(element) {
    const media = element.getAttribute("media");
    return media ? ` media="${escapeAttribute(media)}"` : "";
  }

  /** Sheets of the capture in progress, rendered at its end (see
   * serializeDocument): their text depends on the whole document. */
  let styles = null;
  let pendingSheets = [];
  let placeholderNonce = "";

  /** Comments are never serialized, and markup in text or attributes is
   * escaped: the marker cannot occur otherwise. */
  function sheetPlaceholder(segments, media) {
    const index = pendingSheets.push({ segments, media }) - 1;
    return `<!--dms-marketing-sheet-${placeholderNonce}-${index}-->`;
  }

  function serializeStyle(element) {
    const sheet = element.sheet;
    if (sheet?.disabled) {
      return "";
    }
    const segments = sheet
      ? styles.sheetSegments(sheet, location.href, element.getRootNode())
      : null;
    if (segments === null) {
      const text = element.textContent;
      styles.noteVariables(text);
      return `<style${mediaAttribute(element)}>${text}</style>`;
    }
    return sheetPlaceholder(segments, mediaAttribute(element));
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
    const segments = sheet
      ? styles.sheetSegments(sheet, href, element.getRootNode())
      : null;
    if (segments !== null) {
      return sheetPlaceholder(segments, mediaAttribute(element));
    }
    return `<link rel="stylesheet" href="${escapeAttribute(href)}"${mediaAttribute(element)}>`;
  }

  function adoptedStyles(root) {
    let out = "";
    for (const sheet of root.adoptedStyleSheets || []) {
      out += sheetPlaceholder(
        styles.sheetSegments(sheet, location.href, root) || [],
        "",
      );
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
      css[index] ? `<style${pendingSheets[index].media}>${css[index]}</style>` : "",
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

  async function capture() {
    // The visitor navigated on since the negotiation: this is another page.
    if (location.pathname !== context.path) {
      return;
    }
    const root = document.documentElement;
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
      document: { width: root.scrollWidth, height: root.scrollHeight },
      html,
    });
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
    module.exports = { createStyleCollector, splitSelectorList, testedSelector };
  } else if (asked) {
    whenSettled(() => whenIdle(() => void capture().catch(() => {})));
  }
})();
