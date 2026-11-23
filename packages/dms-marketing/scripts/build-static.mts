import { build, type BuildResult } from "esbuild";
import { join } from "node:path";

const PACKAGE_ROOT = join(import.meta.dirname, "..");

/**
 * Bundles each browser script of `static/` into one plain script under
 * `dist/static/`, the file `staticScript` serves. Each bundle is a single
 * unminified function expression that runs as a classic script.
 *
 * The compiler options are given here and the tsconfig of `static/` is left to
 * the type checker: esbuild would turn that tsconfig's `strict` into a
 * `"use strict"` directive, which the statement the route prepends leaves
 * inert in the served script and a test that loads the bundle alone leaves
 * active. The target is the browsers the scripts have always assumed (ES2021:
 * optional chaining and catch bindings, `replaceAll`), and class fields are
 * assigned in the constructor, not defined, as that target does.
 */
function bundleStaticScripts(): Promise<BuildResult> {
  return build({
    absWorkingDir: PACKAGE_ROOT,
    entryPoints: {
      tracker: "static/tracker/index.ts",
      snapshot: "static/snapshot/index.ts",
    },
    outdir: "dist/static",
    bundle: true,
    format: "iife",
    target: "es2021",
    tsconfigRaw: { compilerOptions: { useDefineForClassFields: false } },
    logLevel: "warning",
  });
}

await bundleStaticScripts();
