import sanitizeHtml from "sanitize-html";

/**
 * Prepended to every stored document. The console renders it in a frame
 * sandboxed without scripts already; the policy holds even where that
 * sandbox would not, and covers what a sandbox leaves open (form targets,
 * plugins, nested frames). Styles, images and fonts stay unrestricted —
 * they are the page. These two remain the primary defence: the sanitizer
 * below is a second layer, not what the console relies on.
 */
const SNAPSHOT_CSP_META =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"script-src 'none'; object-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'none'\">";

/** Elements dropped with their content: code, another document, a form
 * target base, a refresh. Shadow roots (`template`) included, as before. */
const DROPPED_TAGS = new Set([
  "script",
  "iframe",
  "frame",
  "object",
  "embed",
  "applet",
  "portal",
  "noscript",
  "template",
  "base",
  "meta",
]);
const STRIPPED_ATTRIBUTES = new Set(["srcdoc", "action", "formaction"]);
const FORM_CONTROL_TAGS = new Set(["input", "textarea", "select", "option"]);
const FORM_STATE_ATTRIBUTES = new Set(["value", "checked", "selected"]);
/** Void elements, serialized `<tag />` with no end tag (a stray `</br>`
 * would render as one more break). */
const VOID_TAGS = [
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
];
/** Every other scheme — `javascript:` and `vbscript:` first, however
 * entity-encoded or padded — drops the URL attribute carrying it. */
const URL_SCHEMES = [
  "http",
  "https",
  "data",
  "blob",
  "mailto",
  "tel",
  "sms",
  "ftp",
];

function withoutUnsafeAttributes(
  tagName: string,
  attribs: sanitizeHtml.Attributes,
): sanitizeHtml.Tag {
  const formControl = FORM_CONTROL_TAGS.has(tagName);
  const kept: sanitizeHtml.Attributes = {};
  for (const [name, value] of Object.entries(attribs)) {
    if (
      !name.startsWith("on") &&
      !STRIPPED_ATTRIBUTES.has(name) &&
      !(formControl && FORM_STATE_ATTRIBUTES.has(name))
    ) {
      kept[name] = value;
    }
  }
  return { tagName, attribs: kept };
}

/**
 * Every tag and attribute of the page is kept — custom elements, classes,
 * inline styles, `hidden`, data-* — except what the denylists above name;
 * URL attributes (href, src, srcset, xlink:href…) are scheme-checked after
 * entity decoding. A `<style>` is re-emitted verbatim, so one holding a `<`
 * that could open markup — followed by a letter, `!`, `/` or `?`: a tag, a
 * comment or `</style` itself, which inside `<svg>` or `<math>` the browser
 * parses as markup — is dropped rather than risk a parser disagreement. A
 * `<` before anything else is text everywhere and stays: Tailwind's
 * `@media (width < 48rem)`. The capture escapes the character after a `<`
 * in the CSS it serializes, so no sheet of a real page is dropped.
 */
const MARKUP_OPENING = /<[a-z!/?]/i;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: false,
  allowedAttributes: false,
  allowVulnerableTags: true,
  allowedSchemes: URL_SCHEMES,
  nonBooleanAttributes: [],
  parseStyleAttributes: false,
  selfClosing: VOID_TAGS,
  exclusiveFilter: (frame) =>
    DROPPED_TAGS.has(frame.tag) ||
    (frame.tag === "style" && MARKUP_OPENING.test(frame.text)),
  transformTags: {
    textarea: (tagName, attribs) => ({ tagName, attribs, text: "" }),
    "*": withoutUnsafeAttributes,
  },
};

/**
 * The capture script already serializes nothing executable and no form
 * value; this is the server not taking a public upload's word for it —
 * the upload goes through a real HTML parser, scripts, frames, plugins,
 * handlers, script URLs and form values are stripped again before
 * storage, and the policy above goes in front.
 *
 * The parser drops the doctype and comments; a meta ahead of `<html>` opens the
 * head itself, so the policy precedes whatever the document puts there.
 */
export function sanitizeSnapshotHtml(html: string): string {
  return `<!DOCTYPE html>${SNAPSHOT_CSP_META}${sanitizeHtml(html, SANITIZE_OPTIONS)}`;
}

/** Attributes that carry text a visitor could read: the ones
 * static/snapshot.js masks with the text. */
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
const MASK_CHAR = "x";
const CHARACTER_REFERENCE = /&(?:[a-z\d]+|#\d+|#x[\da-f]+);/gi;

/** As the capture masks: every visible character, whitespace kept so
 * lines still wrap where they did. The parser hands text re-escaped, so a
 * character reference is one character. */
function maskText(text: string): string {
  return text.replace(CHARACTER_REFERENCE, MASK_CHAR).replace(/\S/g, MASK_CHAR);
}

function withMaskedAttributes(
  tagName: string,
  attribs: sanitizeHtml.Attributes,
): sanitizeHtml.Tag {
  const tag = withoutUnsafeAttributes(tagName, attribs);
  for (const name of Object.keys(tag.attribs)) {
    if (TEXT_ATTRIBUTES.has(name)) {
      tag.attribs[name] = maskText(tag.attribs[name] ?? "");
    }
  }
  return tag;
}

/** The sanitizer's pass, text masked: `<style>` stays verbatim (the parser
 * hands it to no text filter), so the page keeps its look. */
const MASK_OPTIONS: sanitizeHtml.IOptions = {
  ...SANITIZE_OPTIONS,
  textFilter: maskText,
  transformTags: {
    ...SANITIZE_OPTIONS.transformTags,
    "*": withMaskedAttributes,
  },
};

/**
 * A stored document with its text masked, whatever its site's own mask
 * setting: the structure, blocks and styles stay, every word, label and
 * alternative text becomes `x`. What a backdrop read outside the viewer's
 * workspace sends — another workspace's unmasked capture never leaves the
 * server. Sanitized again on the way, the policy back in front.
 */
export function maskSnapshotHtml(html: string): string {
  return `<!DOCTYPE html>${SNAPSHOT_CSP_META}${sanitizeHtml(html, MASK_OPTIONS)}`;
}
