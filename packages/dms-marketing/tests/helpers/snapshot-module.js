const path = require("node:path");
const vm = require("node:vm");
const { buildSync } = require("esbuild");

const PURE_PARTS = path.join(__dirname, "../../static/snapshot/pure-parts.ts");

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
 * The pure parts of the capture script, bundled from its sources as a
 * CommonJS module: the served script runs in a page and exports nothing.
 * @returns {SnapshotModule}
 */
function loadSnapshotModule() {
  const { outputFiles } = buildSync({
    entryPoints: [PURE_PARTS],
    bundle: true,
    format: "cjs",
    target: "es2021",
    write: false,
    logLevel: "warning",
  });
  /** @type {{ exports: SnapshotModule | null }} */
  const loaded = { exports: null };
  vm.compileFunction(outputFiles[0].text, ["module"])(loaded);
  if (loaded.exports === null) {
    throw new Error("the capture sources exported nothing");
  }
  return loaded.exports;
}

module.exports = { loadSnapshotModule };
