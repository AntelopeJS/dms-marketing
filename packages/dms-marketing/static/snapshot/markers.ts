/** `data-dms-marketing-mask` or the class: the element's text, its text attributes and its link paths are masked. */
export const MASK_MARKER = "dms-marketing-mask";

/** `data-dms-marketing-block` or the class: the element is replaced with an empty box of its size. */
export const BLOCK_MARKER = "dms-marketing-block";

/** Whether the page marked `element` with `marker`, as a data attribute or as a class. */
export function isMarked(element: Element, marker: string): boolean {
  return (
    element.hasAttribute(`data-${marker}`) || element.classList.contains(marker)
  );
}
