/**
 * The parts of the capture script that need no page, for the unit suite to
 * bundle and call: the served script runs in a page and exports nothing.
 *
 * @packageDocumentation
 */
export { contentSize } from "./capture";
export { isTransientOverlay } from "./overlays";
export { splitSelectorList, testedSelector } from "./selectors";
export { createStyleCollector } from "./style-collector";
export { styleText } from "./text";
