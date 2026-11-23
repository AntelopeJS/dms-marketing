import { SCROLL_ROOT_ATTRIBUTE } from "../shared/page";
import { MASK_MARKER } from "./markers";
import { escapeAttribute, maskText } from "./text";
import {
  absolutizeCss,
  absolutizeSrcset,
  absoluteUrl,
  withoutQuery,
} from "./urls";

/** Dropped whatever the element, as is every `on*` handler: an inline document, a nonce or integrity hash, and what submits or pings. */
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

/** What attribute serialization needs from the capture in progress. */
export interface AttributeOptions {
  /** `maskText`: every text node and text attribute of the page is masked; data-* and link paths stay, since styles select on them. */
  readonly maskAllText: boolean;
  /** The page's inner scroll container, marked in the capture, or null when the document scrolls. */
  readonly scrollRoot: Element | null;
  /** Records the custom properties a value refers to. */
  readonly noteVariables: (text: string) => void;
}

function isOmitted(element: Element, name: string): boolean {
  const tag = element.localName;
  return (
    name.startsWith("on") ||
    DROPPED_ATTRIBUTES.has(name) ||
    (name === "value" && (tag === "input" || tag === "textarea")) ||
    (name === "checked" && tag === "input") ||
    (name === "selected" && tag === "option") ||
    (name === "src" && SOURCELESS_TAGS.has(tag)) ||
    (element instanceof HTMLImageElement &&
      !!element.currentSrc &&
      (name === "srcset" || name === "sizes"))
  );
}

function maskedValue(
  name: string,
  value: string,
  masked: boolean,
  maskAllText: boolean,
): string {
  const text = (masked || maskAllText) && TEXT_ATTRIBUTES.has(name);
  const data =
    masked &&
    name.startsWith("data-") &&
    !name.startsWith(`data-${MASK_MARKER}`);
  return text || data ? maskText(value) : value;
}

function imageSource(element: HTMLImageElement, value: string): string {
  const current = element.currentSrc;
  if (current && !current.startsWith("data:")) {
    return current;
  }
  return element.dataset.src || current || value;
}

/** The value as the capture carries it, or null for an attribute left out (a script URL). */
function resolvedValue(
  element: Element,
  name: string,
  value: string,
  masked: boolean,
): string | null {
  const current =
    name === "src" && element instanceof HTMLImageElement
      ? imageSource(element, value)
      : value;
  if (name === "srcset") {
    return absolutizeSrcset(current, location.href);
  }
  if (name === "style") {
    return absolutizeCss(current, location.href);
  }
  if (!URL_ATTRIBUTES.has(name)) {
    return current;
  }
  const absolute = absoluteUrl(current, location.href);
  if (absolute === null) {
    return null;
  }
  return LINK_TAGS.has(element.localName)
    ? withoutQuery(absolute, masked)
    : absolute;
}

/** The attributes of `element` as the text of a start tag, with `masked` text attributes masked. */
export function serializeAttributes(
  element: Element,
  masked: boolean,
  options: AttributeOptions,
): string {
  let out = "";
  for (const attribute of element.attributes) {
    const name = attribute.name;
    if (isOmitted(element, name)) {
      continue;
    }
    const value = resolvedValue(
      element,
      name,
      maskedValue(name, attribute.value, masked, options.maskAllText),
      masked,
    );
    if (value === null) {
      continue;
    }
    if (value.includes("var(")) {
      options.noteVariables(value);
    }
    out += ` ${name}="${escapeAttribute(value)}"`;
  }
  if (
    element === options.scrollRoot &&
    !element.hasAttribute(SCROLL_ROOT_ATTRIBUTE)
  ) {
    out += ` ${SCROLL_ROOT_ATTRIBUTE}=""`;
  }
  return out;
}
