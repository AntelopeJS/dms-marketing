const MASK_CHAR = "x";

/** Text as the content of an element. */
export function escapeText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Text as the value of a double-quoted attribute. */
export function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

/** Whitespace survives so lines still wrap where they did. */
export function maskText(text: string): string {
  return text.replace(/\S/g, MASK_CHAR);
}

/**
 * CSS as the text of a `<style>`: the character after a `<` that could open
 * markup (a letter, `!`, `/`, `?`) is written as a CSS escape, the same
 * token to CSS (`</style` in a string becomes `<\2f style`), so nothing in it
 * closes the element and the server keeps the sheet.
 */
export function styleText(css: string): string {
  return css.replace(
    /<([a-z!/?])/gi,
    (_match, next: string) => `<\\${next.charCodeAt(0).toString(16)} `,
  );
}
