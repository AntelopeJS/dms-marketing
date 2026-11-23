import { readFileSync } from "node:fs";
import path from "node:path";

/** dist/services → dist/static, where `pnpm build` bundles the browser scripts from the package's `static/`. */
const STATIC_ROOT = path.join(__dirname, "../static");

/** The browser scripts the module serves. */
export type StaticScriptName = "snapshot" | "tracker";

const scripts = new Map<StaticScriptName, string>();

/** A served script: the one self-contained bundle of its modules in `static/<name>/`. */
export function staticScript(name: StaticScriptName): string {
  const cached = scripts.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const script = readFileSync(path.join(STATIC_ROOT, `${name}.js`), "utf8");
  scripts.set(name, script);
  return script;
}
