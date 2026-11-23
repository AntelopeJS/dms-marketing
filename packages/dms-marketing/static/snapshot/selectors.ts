/** Selectors `querySelector` cannot answer for from the sheet's scope: the rule is kept. */
const UNTESTABLE_SELECTOR_PATTERN =
  /:host|::slotted|::part|::cue|::highlight|::view-transition|:state\(|&|:scope/;

/** A pseudo-element renders on its element: the rule is tested on it. */
const PSEUDO_ELEMENT_PATTERN =
  /::[\w-]+|:(?:before|after|first-line|first-letter)(?![\w-])/g;

/** States a snapshot may be looked at in, or a visitor's input sets: the rule is tested as if the state held. */
const STATE_PSEUDO_CLASS_PATTERN =
  /:(?:hover|focus|focus-visible|focus-within|active|visited|link|any-link|target|target-within|checked|indeterminate|placeholder-shown|autofill|valid|invalid|user-valid|user-invalid|in-range|out-of-range|open|closed|popover-open|modal|fullscreen|playing|paused)(?![\w-])/g;

const COMBINATOR_SPACING_PATTERN = /\s*([>+~])\s*/g;

/** A compound the stripping left empty stands for any element. */
const EMPTY_COMPOUND_PATTERN = /(^|[\s>+~(,])(?=$|[\s>+~),])/g;
const NEGATED_ANY_PATTERN = /:not\(\*\)/g;
const ESCAPED_COLON_PATTERN = /\\:/g;

/** Stands in for an escaped colon while pseudo-classes are stripped. */
const ESCAPED_COLON_TOKEN = "\u0001";

/** Selector list split on its top-level commas. */
export function splitSelectorList(list: string): string[] {
  const parts: string[] = [];
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

/**
 * One selector as tested, null when it cannot be (the rule stays). An
 * escaped colon belongs to a class name (`.md\:hover\:flex`), so it is set
 * aside while pseudo-classes are stripped. `.a > ::before` becomes `.a>*`,
 * and `.a:not(:hover)` becomes `.a`, not `.a:not(*)`, which would match
 * nothing.
 */
export function testedSelector(selector: string): string | null {
  if (UNTESTABLE_SELECTOR_PATTERN.test(selector)) {
    return null;
  }
  const escaped = selector.replace(ESCAPED_COLON_PATTERN, ESCAPED_COLON_TOKEN);
  const stripped = escaped
    .replace(PSEUDO_ELEMENT_PATTERN, "")
    .replace(STATE_PSEUDO_CLASS_PATTERN, "");
  if (stripped === escaped) {
    return selector;
  }
  return stripped
    .replace(COMBINATOR_SPACING_PATTERN, "$1")
    .trim()
    .replace(EMPTY_COMPOUND_PATTERN, "$1*")
    .replace(NEGATED_ANY_PATTERN, "")
    .replaceAll(ESCAPED_COLON_TOKEN, "\\:");
}

/** Whether the scope holds an element matching `selector`; one this browser cannot parse (a vendor pseudo-class, a newer syntax) may well match, so it stays. */
export function selectorMatches(scope: ParentNode, selector: string): boolean {
  try {
    return scope.querySelector(selector) !== null;
  } catch {
    return true;
  }
}
