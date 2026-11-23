import { type AttributeOptions, serializeAttributes } from "./attributes";
import { BLOCK_MARKER, MASK_MARKER, isMarked } from "./markers";
import { isTransientOverlay } from "./overlays";
import { type Segment, createStyleCollector } from "./style-collector";
import { escapeAttribute, escapeText, maskText, styleText } from "./text";

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

/**
 * Nothing of theirs renders in a script-less document (noscript included,
 * whose content WOULD render there), or their content is another document,
 * plugin or stream.
 */
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

/** A canvas past this many data-URL characters ships empty. */
const MAX_CANVAS_DATA_URL_LENGTH = 200000;

/** A stylesheet waiting for the whole document to say which variables it needs. */
interface PendingSheet {
  readonly segments: readonly Segment[];
  readonly media: string;
}

function computedPosition(element: Element): string {
  return getComputedStyle(element).position;
}

function mediaAttribute(element: Element): string {
  const media = element.getAttribute("media");
  return media ? ` media="${escapeAttribute(media)}"` : "";
}

function sheetOf(element: Element): CSSStyleSheet | null {
  return element instanceof HTMLStyleElement ||
    element instanceof HTMLLinkElement ||
    element instanceof SVGStyleElement
    ? element.sheet
    : null;
}

function scopeOf(element: Element): ParentNode {
  const root = element.getRootNode();
  return root instanceof Document || root instanceof DocumentFragment
    ? root
    : document;
}

function isHiddenInput(element: Element): boolean {
  return element instanceof HTMLInputElement && element.type === "hidden";
}

function isEditable(element: Element): boolean {
  return element instanceof HTMLElement && element.isContentEditable;
}

/**
 * The element's own box, nothing inside it. Id and class stay so the page's
 * CSS still lays it out, and click anchors still resolve to it. The box is
 * the border box the visitor saw, capped at its container so a narrower
 * layout reflows it instead of overflowing.
 */
function serializeBlocked(element: Element): string {
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

/** Tainted by cross-origin drawing: the box stays, the pixels do not. */
function canvasDataUrl(element: HTMLCanvasElement): string {
  try {
    return element.toDataURL();
  } catch {
    return "";
  }
}

/**
 * The rendered DOM of one capture as a single self-contained HTML document.
 * Stylesheets are rendered at its end: their text depends on the whole
 * document. Each is left in the markup as a comment placeholder, which cannot
 * occur otherwise: comments are never serialized, and markup in text or
 * attributes is escaped.
 */
export class DocumentSerializer {
  private readonly styles = createStyleCollector();

  private readonly pendingSheets: PendingSheet[] = [];

  private readonly placeholderNonce = Math.random().toString(36).slice(2);

  private readonly attributeOptions: AttributeOptions;

  constructor(
    private readonly maskAllText: boolean,
    scrollRoot: Element | null,
  ) {
    this.attributeOptions = {
      maskAllText,
      scrollRoot,
      noteVariables: (text) => this.styles.noteVariables(text),
    };
  }

  serialize(): string {
    const html = `<!DOCTYPE html>${this.serializeElement(document.documentElement, false)}`;
    const css = this.styles.finish(
      this.pendingSheets.map((sheet) => sheet.segments),
    );
    const marker = new RegExp(
      `<!--dms-marketing-sheet-${this.placeholderNonce}-([0-9]+)-->`,
      "g",
    );
    return html.replace(marker, (_match, index: string) => {
      const position = Number(index);
      return css[position]
        ? `<style${this.pendingSheets[position].media}>${styleText(css[position])}</style>`
        : "";
    });
  }

  private sheetPlaceholder(
    segments: readonly Segment[],
    media: string,
  ): string {
    const index = this.pendingSheets.push({ segments, media }) - 1;
    return `<!--dms-marketing-sheet-${this.placeholderNonce}-${index}-->`;
  }

  private serializeStyle(element: Element): string {
    const sheet = sheetOf(element);
    if (sheet?.disabled) {
      return "";
    }
    const segments = sheet
      ? this.styles.sheetSegments(sheet, location.href, scopeOf(element))
      : null;
    if (segments === null) {
      const text = element.textContent ?? "";
      this.styles.noteVariables(text);
      return `<style${mediaAttribute(element)}>${styleText(text)}</style>`;
    }
    return this.sheetPlaceholder(segments, mediaAttribute(element));
  }

  /** Only stylesheets render; preloads, icons and manifests are requests the backdrop has no use for. */
  private serializeLink(element: HTMLLinkElement): string {
    const rel = (element.getAttribute("rel") || "").toLowerCase().split(/\s+/);
    const sheet = element.sheet;
    if (!rel.includes("stylesheet") || sheet?.disabled) {
      return "";
    }
    const href = element.href;
    const segments = sheet
      ? this.styles.sheetSegments(sheet, href, scopeOf(element))
      : null;
    if (segments !== null) {
      return this.sheetPlaceholder(segments, mediaAttribute(element));
    }
    return `<link rel="stylesheet" href="${escapeAttribute(href)}"${mediaAttribute(element)}>`;
  }

  private adoptedStyles(root: Document | ShadowRoot): string {
    let out = "";
    for (const sheet of root.adoptedStyleSheets || []) {
      out += this.sheetPlaceholder(
        this.styles.sheetSegments(sheet, location.href, root) || [],
        "",
      );
    }
    return out;
  }

  private serializeCanvas(element: HTMLCanvasElement, masked: boolean): string {
    const dataUrl = canvasDataUrl(element);
    const attributes = serializeAttributes(
      element,
      masked,
      this.attributeOptions,
    );
    if (dataUrl && dataUrl.length <= MAX_CANVAS_DATA_URL_LENGTH) {
      return `<img${attributes} src="${dataUrl}">`;
    }
    return `<canvas${attributes}></canvas>`;
  }

  private serializeChildren(node: Node, masked: boolean): string {
    let out = "";
    for (const child of node.childNodes) {
      if (child instanceof Element) {
        out += this.serializeElement(child, masked);
      } else if (child instanceof Text) {
        const text =
          masked || this.maskAllText ? maskText(child.data) : child.data;
        out += escapeText(text);
      }
    }
    return out;
  }

  private serializeContent(element: Element, masked: boolean): string {
    const tag = element.localName;
    if (tag === "textarea") {
      return "";
    }
    let out = "";
    if (element.shadowRoot) {
      out += `<template shadowrootmode="open">${this.adoptedStyles(element.shadowRoot)}${this.serializeChildren(element.shadowRoot, masked)}</template>`;
    }
    if (tag === "head") {
      out += '<meta charset="utf-8">';
    }
    out += this.serializeChildren(element, masked);
    if (tag === "head") {
      out += this.adoptedStyles(document);
    }
    return out;
  }

  private serializeElement(element: Element, masked: boolean): string {
    const tag = element.localName;
    if (DROPPED_TAGS.has(tag) || isHiddenInput(element)) {
      return "";
    }
    if (tag === "style") {
      return this.serializeStyle(element);
    }
    if (element instanceof HTMLLinkElement) {
      return this.serializeLink(element);
    }
    if (isMarked(element, BLOCK_MARKER)) {
      return serializeBlocked(element);
    }
    if (isTransientOverlay(element, computedPosition, document.body)) {
      return "";
    }
    const mask =
      masked || isMarked(element, MASK_MARKER) || isEditable(element);
    if (element instanceof HTMLCanvasElement) {
      return this.serializeCanvas(element, mask);
    }
    const start = `<${tag}${serializeAttributes(element, mask, this.attributeOptions)}>`;
    if (VOID_TAGS.has(tag)) {
      return start;
    }
    return `${start}${this.serializeContent(element, mask)}</${tag}>`;
  }
}
