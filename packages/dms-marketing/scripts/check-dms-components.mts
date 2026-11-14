import { readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, join, relative, sep } from "node:path";

/**
 * Every `Dms*` and `dms-*` tag in the frontend's `.vue` files names a
 * component that is registered at runtime: one the installed `@antelopejs/dms`
 * or `@antelopejs/dms-frontend` ships, or one of this module's own
 * `DmsMarketing*` components. Vue leaves an unknown tag unrendered without an
 * error, so a renamed DMS component would otherwise vanish from the screen.
 * Prints the unknown tags only; exits 1 when there are any.
 */

const PACKAGE = join(import.meta.dirname, "..");
const FRONTEND = join(PACKAGE, "frontend-vue");
const OWN_COMPONENTS = join(FRONTEND, "app", "components");
const OWN_PREFIX = "DmsMarketing";
const DMS_PREFIX = "Dms";

/** The fewest components the installed DMS registers: a scan finding fewer missed them. */
const MIN_SHIPPED = 100;
/** The fewest DMS tags the frontend uses: a scan finding fewer missed them. */
const MIN_TAGS = 100;

const PASCAL_TAG = /<(Dms[A-Za-z0-9]*)\b/g;
const KEBAB_TAG = /<(dms-[a-z0-9]+(?:-[a-z0-9]+)*)\b/g;
const ALIAS_BLOCK = /COMPONENT_ALIASES[^=]*=\s*\{([^}]*)\}/;
const ALIAS_VALUE = /:\s*"(\w+)"/g;

const require = createRequire(join(PACKAGE, "package.json"));

function packageRoot(name: string): string {
  return dirname(require.resolve(`${name}/package.json`));
}

function vueFiles(directory: string): string[] {
  return readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".vue") && !path.includes("node_modules"))
    .map((path) => join(directory, path));
}

/** The name `@antelopejs/dms` registers a component file under, without its prefix. */
function pascalCase(file: string): string {
  return basename(file, ".vue")
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

function dmsComponents(): string[] {
  const frontend = join(packageRoot("@antelopejs/dms"), "frontend-vue");
  const files = vueFiles(join(frontend, "layers")).filter((file) =>
    /\/app\/(?:build\/)?components\//.test(file.split(sep).join("/")),
  );
  const aliasBlock = ALIAS_BLOCK.exec(
    readFileSync(join(frontend, "dms.frontend.ts"), "utf8"),
  );
  if (!aliasBlock?.[1]) {
    throw new Error("dms.frontend.ts declares no COMPONENT_ALIASES");
  }
  const aliases = [...aliasBlock[1].matchAll(ALIAS_VALUE)].map(
    (match) => match[1] ?? "",
  );
  return [...files.map(pascalCase), ...aliases].map(
    (name) => `${DMS_PREFIX}${name}`,
  );
}

function dmsFrontendComponents(): string[] {
  return vueFiles(join(packageRoot("@antelopejs/dms-frontend"), "templates"))
    .map((file) => basename(file, ".vue"))
    .filter((name) => name.startsWith(DMS_PREFIX));
}

function ownComponents(): string[] {
  return vueFiles(OWN_COMPONENTS).map(
    (file) => `${OWN_PREFIX}${basename(file, ".vue")}`,
  );
}

function kebabToPascal(tag: string): string {
  return tag
    .split("-")
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join("");
}

interface TagUse {
  file: string;
  line: number;
  tag: string;
  name: string;
}

function tagUses(file: string): TagUse[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((text, index) =>
      [
        ...[...text.matchAll(PASCAL_TAG)].map((match) => match[1] ?? ""),
        ...[...text.matchAll(KEBAB_TAG)].map((match) => match[1] ?? ""),
      ].map((tag) => ({
        file,
        line: index + 1,
        tag,
        name: tag.includes("-") ? kebabToPascal(tag) : tag,
      })),
    );
}

const shipped = dmsComponents();
const known = new Set([
  ...shipped,
  ...dmsFrontendComponents(),
  ...ownComponents(),
]);
const uses = vueFiles(join(FRONTEND, "app")).flatMap(tagUses);
const unknown = uses.filter((use) => !known.has(use.name));

const failures = [
  ...(shipped.length < MIN_SHIPPED
    ? [
        `found ${shipped.length} @antelopejs/dms components, expected at least ${MIN_SHIPPED}`,
      ]
    : []),
  ...(uses.length < MIN_TAGS
    ? [
        `found ${uses.length} DMS tags in frontend-vue/app, expected at least ${MIN_TAGS}`,
      ]
    : []),
  ...unknown.map(
    (use) =>
      `${relative(PACKAGE, use.file)}:${use.line}: <${use.tag}> is not a component @antelopejs/dms, @antelopejs/dms-frontend or this module registers`,
  ),
];

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
}
