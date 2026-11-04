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

  /** CSS as the text of a `<style>`: the character after a `<` that could
   * open markup (a letter, `!`, `/`, `?`) is written as a CSS escape, the
   * same token to CSS (`</style` in a string becomes `<\2f style`), so
   * nothing in it closes the element and the server keeps the sheet. */
  function styleText(css) {
    return css.replace(
      /<([a-z!/?])/gi,
      (_match, next) => `<\\${next.charCodeAt(0).toString(16)} `,
    );
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
  /** The page's inner scroll container during a capture, null when the
   * document scrolls. */
  let scrollRootElement = null;

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
      return `<style${mediaAttribute(element)}>${styleText(text)}</style>`;
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

