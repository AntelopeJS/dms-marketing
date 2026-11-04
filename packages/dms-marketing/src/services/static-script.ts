import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

/** dist/services → package root; `static` ships in the published files list. */
const STATIC_ROOT = path.join(__dirname, "../../static");

/** The browser scripts the module serves, each kept as ordered parts under `static/<name>/`. */
export type StaticScriptName = "snapshot" | "tracker";

const scripts = new Map<StaticScriptName, string>();

/**
 * A served script: its parts, joined in file-name order. The parts are cut
 * from one script at its section headers, so joining them restores the whole
 * and no part has to stay under the size limit with the rest.
 */
export function staticScript(name: StaticScriptName): string {
  const cached = scripts.get(name);
  if (cached !== undefined) {
    return cached;
  }
  const directory = path.join(STATIC_ROOT, name);
  const script = readdirSync(directory)
    .sort()
    .map((part) => readFileSync(path.join(directory, part), "utf8"))
    .join("");
  scripts.set(name, script);
  return script;
}
