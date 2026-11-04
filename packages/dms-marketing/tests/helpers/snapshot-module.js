const vm = require("node:vm");
const { staticScript } = require("../../dist/services/static-script");

/**
 * @typedef {object} StyleCollector
 * @property {(
 *   sheet: { cssRules: unknown },
 *   base: string,
 *   scope: { querySelector(selector: string): unknown },
 * ) => unknown[] | null} sheetSegments
 * @property {(segments: unknown[]) => unknown[]} finish
 */

/**
 * @typedef {object} SnapshotModule
 * @property {(
 *   root: { scrollWidth: number, scrollHeight: number },
 *   scrollRoot: { scrollHeight: number, clientHeight: number } | null,
 * ) => { width: number, height: number }} contentSize
 * @property {() => StyleCollector} createStyleCollector
 * @property {(list: string) => string[]} splitSelectorList
 * @property {(css: string) => string} styleText
 * @property {(selector: string) => string | null} testedSelector
 * @property {(
 *   element: unknown,
 *   positionOf: (node: never) => string,
 *   body: unknown,
 * ) => boolean} isTransientOverlay
 */

/**
 * The pure parts of the capture script, loaded the way a CommonJS module is:
 * with no `window` and a `module` to export them on.
 * @returns {SnapshotModule}
 */
function loadSnapshotModule() {
  /** @type {{ exports: SnapshotModule | null }} */
  const loaded = { exports: null };
  vm.compileFunction(staticScript("snapshot"), ["module"])(loaded);
  if (loaded.exports === null) {
    throw new Error("the capture script exported nothing");
  }
  return loaded.exports;
}

module.exports = { loadSnapshotModule };
