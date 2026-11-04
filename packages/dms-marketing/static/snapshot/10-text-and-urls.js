/**
 * dms-marketing page snapshot capture.
 *
 * Served by GET /api/marketing/snapshot.js to a sampled visit the backend
 * wants a capture from (see static/tracker/), with the site's settings
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
 *
 * Transient overlays open at capture time — a prompt, a toast, an open
 * menu or popover floating over the page — are left out (see
 * isTransientOverlay): they belong to that one visit, not to the page.
 *
 * A page whose document does not scroll, an inner container doing it
 * instead (see the scroll root in static/tracker/), is captured with that
 * container marked `data-marketing-scroll-root` and the height of its whole
 * content recorded: the preview unrolls it, as tall as the page really is.
 */
(() => {
  const CONFIG_GLOBAL = "__dmsMarketingSnapshotConfig";
  const CONTEXT_GLOBAL = "__dmsMarketingSnapshotContext";
  const MASK_MARKER = "dms-marketing-mask";
  const BLOCK_MARKER = "dms-marketing-block";
  /** Marks the page's inner scroll container in the capture (see above). */
  const SCROLL_ROOT_ATTRIBUTE = "data-marketing-scroll-root";
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
  /** Roles of the overlays a visit opens over the page, dropped when they
   * float over it (see isTransientOverlay). */
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

