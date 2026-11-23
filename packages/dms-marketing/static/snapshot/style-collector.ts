import {
  selectorMatches,
  splitSelectorList,
  testedSelector,
} from "./selectors";
import { absolutizeCss } from "./urls";

const STYLE_RULE = 1;
const IMPORT_RULE = 3;
const KEYFRAMES_RULE = 7;
const CSS_VARIABLE_PATTERN = /var\(\s*(--[\w-]+)/g;
const LAYER_PRELUDE_PATTERN = /^@layer\b/;

/** A custom property declaration of a kept rule, as written in its text. */
interface Declaration {
  readonly name: string;
  readonly source: string;
}

/** A kept style rule whose custom property declarations are set apart, so they can be dropped once nothing refers to them. */
interface RuleSegment {
  readonly text: string;
  readonly declarations: readonly Declaration[];
}

/** A piece of a sheet: a string kept as it is, or a style rule with its declarations set apart. */
export type Segment = string | RuleSegment;

type GroupingRule = CSSRule & { readonly cssRules: CSSRuleList };

function isImportRule(rule: CSSRule): rule is CSSImportRule {
  return rule.type === IMPORT_RULE;
}

function isStyleRule(rule: CSSRule): rule is CSSStyleRule {
  return rule.type === STYLE_RULE;
}

function holdsRules(rule: CSSRule): rule is GroupingRule {
  return "cssRules" in rule && !!rule.cssRules && rule.type !== KEYFRAMES_RULE;
}

function isText(segment: Segment): segment is string {
  return typeof segment === "string";
}

function cssVariables(text: string, into: Set<string>): void {
  for (const match of text.matchAll(CSS_VARIABLE_PATTERN)) {
    into.add(match[1]);
  }
}

function render(
  segments: readonly Segment[],
  reached: ReadonlySet<string>,
): string {
  let out = "";
  for (const segment of segments) {
    if (isText(segment)) {
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

/**
 * What the stylesheets of one capture keep, across every sheet and shadow
 * root: custom properties inherit, so a variable one sheet defines another
 * uses. Sheets are read into segments first (strings, or style rules with
 * their custom property declarations set apart), and rendered once every
 * sheet and inline style has said which variables it needs.
 *
 * A page carries far more CSS than it uses (a framework's utilities, a
 * component library, every layer a host app loads), and a capture inlining
 * all of it routinely weighs megabytes. A style rule is kept only when its
 * selector matches an element of the captured document, tested with the
 * states it depends on (hover, focus, open…) and its pseudo-element taken
 * off, so whatever could show in the snapshot keeps its style; a selector
 * the browser cannot test is kept. Custom properties that no kept rule,
 * inline style or kept property value refers to are dropped. Conditional
 * wrappers (@media, @supports, @container…) stay around the rules they still
 * hold, every layout's and not only the visitor's, and @layer blocks stay
 * even empty (their order is the cascade's), as do @font-face, @keyframes,
 * @property and the other at-rules. A stylesheet identical to one already
 * serialized is not repeated.
 */
export class StyleCollector {
  /** Variables referred to outside a custom property's own value. */
  private readonly used = new Set<string>();

  /** Every kept value of each custom property, for the transitive pass. */
  private readonly definitions = new Map<string, string[]>();

  /** Per scope (document, shadow root): selector list → applies. */
  private readonly verdicts = new Map<ParentNode, Map<string, boolean>>();

  /** Variables an inline style or an attribute refers to. */
  noteVariables(text: string): void {
    cssVariables(text, this.used);
  }

  /**
   * The rules of a sheet worth keeping, as segments, tested against `scope`
   * (the document, or the shadow root holding the sheet). Null when the
   * browser refuses to read them (cross-origin sheet): the caller keeps a
   * link then. Rules are read from the CSSOM, not from the element's text:
   * CSS-in-JS libraries insert theirs with `insertRule`, leaving the
   * `<style>` empty. Readable imports are inlined in place, under their
   * media.
   */
  sheetSegments(
    sheet: CSSStyleSheet,
    base: string,
    scope: ParentNode,
  ): Segment[] | null {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      return null;
    }
    return this.ruleListSegments(rules, base, scope);
  }

  /** Each sheet's final text; empty for one already rendered. */
  finish(sheets: readonly (readonly Segment[])[]): string[] {
    const reached = this.reachableVariables();
    const seen = new Set<string>();
    return sheets.map((segments) => {
      const css = render(segments, reached);
      if (seen.has(css)) {
        return "";
      }
      seen.add(css);
      return css;
    });
  }

  private keptText(text: string): string {
    cssVariables(text, this.used);
    return text;
  }

  private ruleApplies(scope: ParentNode, selectorText: string): boolean {
    let cache = this.verdicts.get(scope);
    if (!cache) {
      cache = new Map();
      this.verdicts.set(scope, cache);
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

  /** A kept style rule; a declaration whose text cannot be located in the rule's stays in it. */
  private styleRuleSegment(rule: CSSStyleRule, base: string): Segment {
    const text = absolutizeCss(rule.cssText, base);
    const style = rule.style;
    const declarations: Declaration[] = [];
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
      const values = this.definitions.get(name) || [];
      values.push(value);
      this.definitions.set(name, values);
    }
    cssVariables(rest, this.used);
    return declarations.length > 0 ? { text, declarations } : text;
  }

  private ruleListSegments(
    rules: CSSRuleList,
    base: string,
    scope: ParentNode,
  ): Segment[] {
    const segments: Segment[] = [];
    for (const rule of rules) {
      segments.push(...this.ruleSegments(rule, base, scope));
    }
    return segments;
  }

  private importSegments(
    rule: CSSImportRule,
    base: string,
    scope: ParentNode,
  ): Segment[] {
    const imported = rule.styleSheet
      ? this.sheetSegments(rule.styleSheet, rule.styleSheet.href || base, scope)
      : null;
    if (imported === null) {
      return [this.keptText(absolutizeCss(rule.cssText, base))];
    }
    const media = rule.media?.mediaText;
    return media ? [`@media ${media}{`, ...imported, "}"] : imported;
  }

  /** Nested rules included: each one only matches within (or on) an element its parent matches. */
  private styleSegments(
    rule: CSSStyleRule,
    base: string,
    scope: ParentNode,
  ): Segment[] {
    if (!this.ruleApplies(scope, rule.selectorText)) {
      return [];
    }
    return rule.cssRules?.length
      ? [this.keptText(absolutizeCss(rule.cssText, base))]
      : [this.styleRuleSegment(rule, base)];
  }

  /** A grouping rule: its prelude is whatever precedes its block. */
  private groupSegments(
    rule: GroupingRule,
    base: string,
    scope: ParentNode,
  ): Segment[] {
    const prelude = rule.cssText.slice(0, rule.cssText.indexOf("{"));
    const inner = this.ruleListSegments(rule.cssRules, base, scope);
    if (inner.length === 0 && !LAYER_PRELUDE_PATTERN.test(prelude)) {
      return [];
    }
    return [`${prelude}{`, ...inner, "}"];
  }

  private ruleSegments(
    rule: CSSRule,
    base: string,
    scope: ParentNode,
  ): Segment[] {
    if (isImportRule(rule)) {
      return this.importSegments(rule, base, scope);
    }
    if (isStyleRule(rule)) {
      return this.styleSegments(rule, base, scope);
    }
    if (holdsRules(rule)) {
      return this.groupSegments(rule, base, scope);
    }
    return [this.keptText(absolutizeCss(rule.cssText, base))];
  }

  /** Every variable reachable from what the capture uses. */
  private reachableVariables(): Set<string> {
    const reached = new Set(this.used);
    const pending = [...this.used];
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      for (const value of this.definitions.get(name) || []) {
        const found = new Set<string>();
        cssVariables(value, found);
        for (const reference of found) {
          if (!reached.has(reference)) {
            reached.add(reference);
            pending.push(reference);
          }
        }
      }
    }
    return reached;
  }
}

export function createStyleCollector(): StyleCollector {
  return new StyleCollector();
}
