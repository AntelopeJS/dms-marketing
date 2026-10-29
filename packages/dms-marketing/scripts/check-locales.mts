import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Invariants between the frontend's locale catalogs and the sources that name
 * their keys: both locales carry the same keys, the surfaces' namespaces exist,
 * and every static key a component asks for, a page declares as a block, or
 * the backend emits resolves to a message in each locale. Keys built from a
 * template expression are resolved at runtime and are not checked. Prints the
 * violations only; exits 1 when there are any.
 */

type Messages = { [key: string]: string | Messages };

const PACKAGE = join(import.meta.dirname, "..");
const FRONTEND = join(PACKAGE, "frontend-vue");
const BACKEND_SOURCE = join(PACKAGE, "src");
const COMPONENT_SOURCE = join(FRONTEND, "app");
const LOCALES = join(FRONTEND, "i18n", "locales");

const NAMESPACES = [
  "context",
  "overview",
  "acquisition",
  "pages",
  "funnels",
  "funnel",
  "experiment",
  "builder",
  "websites",
  "install",
  "settings",
  "blocks",
  "errors",
];
/** The fewest blocks the pages declare: a scan finding fewer missed them. */
const MIN_BLOCKS = 21;

/** `$page.marketing.a.b` as the backend writes it; a trailing dot is a template prefix. */
const BACKEND_KEY = /\$page\.marketing\.[\w.]+/g;
/** `t('page.marketing.a.b'` as the components call it. */
const COMPONENT_KEY = /t\('(page\.marketing\.[\w.-]+)'/g;
/** The key argument of `MarketingBlock(name, key, …)` and of `blockMeta(key, …)`. */
const BLOCK_KEY =
  /(?:MarketingBlock\(\s*"\w+",\s*|blockMeta\(\s*)[`"]([\w${}.-]+)[`"]/g;

function isMessageTree(value: unknown): value is Messages {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(isMessage)
  );
}

function isMessage(value: unknown): value is string | Messages {
  return typeof value === "string" || isMessageTree(value);
}

function isText(node: string | Messages): node is string {
  return typeof node === "string";
}

const shown = (file: string): string => relative(PACKAGE, file);

const sources = (directory: string, extensions: string[]): string[] =>
  readdirSync(directory, { recursive: true, encoding: "utf8" })
    .filter((file) => extensions.some((extension) => file.endsWith(extension)))
    .sort()
    .map((file) => readFileSync(join(directory, file), "utf8"));

function readLocale(name: string): Messages {
  const file = join(LOCALES, `marketing-${name}.json`);
  const messages: unknown = JSON.parse(readFileSync(file, "utf8"));
  if (!isMessageTree(messages)) {
    throw new Error(`${shown(file)}: not a tree of string messages`);
  }
  return messages;
}

function keysOf(messages: Messages, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, child]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return isText(child) ? [path] : keysOf(child, path);
  });
}

/** The message or subtree under a dotted key, by own keys only. */
function lookup(
  messages: Messages,
  key: string,
): string | Messages | undefined {
  let node: string | Messages = messages;
  for (const part of key.split(".")) {
    if (isText(node) || !Object.hasOwn(node, part)) {
      return undefined;
    }
    node = node[part];
  }
  return node;
}

function resolves(messages: Messages, key: string): boolean {
  const node = lookup(messages, key);
  return node !== undefined && isText(node);
}

const unique = (keys: string[]): string[] => [...new Set(keys)].sort();

const backendKeys = unique(
  sources(BACKEND_SOURCE, [".ts"]).flatMap((source) =>
    [...source.matchAll(BACKEND_KEY)]
      .map(([literal]) => literal.slice(1))
      .filter((key) => !key.endsWith(".")),
  ),
);
const componentKeys = unique(
  sources(COMPONENT_SOURCE, [".vue", ".ts"]).flatMap((source) =>
    [...source.matchAll(COMPONENT_KEY)].map(([, key]) => key ?? ""),
  ),
);
const blocks = unique(
  sources(join(BACKEND_SOURCE, "pages"), [".ts"]).flatMap((source) =>
    [...source.matchAll(BLOCK_KEY)]
      .map(([, key]) => key ?? "")
      .filter((key) => !key.includes("$")),
  ),
);

const locales = new Map([
  ["en-GB", readLocale("en-GB")],
  ["fr-FR", readLocale("fr-FR")],
]);
const failures: string[] = [];

const [english, ...others] = [...locales];
for (const [name, messages] of others) {
  const own = new Set(keysOf(messages));
  const reference = new Set(keysOf(english[1]));
  for (const key of reference.difference(own)) {
    failures.push(`${name}: "${key}" of ${english[0]} is missing`);
  }
  for (const key of own.difference(reference)) {
    failures.push(`${name}: "${key}" is not in ${english[0]}`);
  }
}

for (const namespace of NAMESPACES) {
  if (lookup(english[1], `page.marketing.${namespace}`) === undefined) {
    failures.push(`${english[0]}: no "page.marketing.${namespace}" namespace`);
  }
}

if (componentKeys.length === 0) {
  failures.push("no component asks for a static key");
}
if (backendKeys.length === 0) {
  failures.push("the backend emits no static key");
}
if (blocks.length < MIN_BLOCKS) {
  failures.push(
    `the pages declare ${blocks.length} blocks, fewer than ${MIN_BLOCKS}`,
  );
}

const required = [
  ...componentKeys.map((key) => ({ key, from: "a component" })),
  ...backendKeys.map((key) => ({ key, from: "the backend" })),
  ...blocks.flatMap((block) =>
    ["name", "description"].map((field) => ({
      key: `page.marketing.blocks.${block}.${field}`,
      from: `block ${block}`,
    })),
  ),
];
for (const [name, messages] of locales) {
  for (const { key, from } of required) {
    if (!resolves(messages, key)) {
      failures.push(`${name}: "${key}" (${from}) has no message`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
