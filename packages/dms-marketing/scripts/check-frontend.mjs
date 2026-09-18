// Builds this package's frontend module through the real DMS frontend loader:
// the generated Vue workspace, its client bundle, its SSR bundle and vue-tsc.
// `DMS_SOURCE` and `DMS_ADAPTER_SOURCE` point the check at local checkouts of
// `@antelopejs/dms` and `@antelopejs/dms-frontend` when those are not installed.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);

function packageRoot(name) {
  try {
    return dirname(require.resolve(`${name}/package.json`));
  } catch {
    return null;
  }
}

const dmsRoot = resolve(
  process.env.DMS_SOURCE ?? packageRoot("@antelopejs/dms") ?? "",
);
const adapterRoot = resolve(
  process.env.DMS_ADAPTER_SOURCE ??
    packageRoot("@antelopejs/dms-frontend") ??
    "",
);
const adapterEntry = join(adapterRoot, "dist/common.js");
assert.ok(
  existsSync(adapterEntry),
  "The DMS frontend package must expose dist/common.js",
);
assert.ok(
  existsSync(join(dmsRoot, "frontend-vue/dms.frontend.ts")),
  "The DMS package must include frontend-vue",
);

const { createFrontendModuleRegistry, writeFrontendModuleRegistry } =
  await import(pathToFileURL(adapterEntry));
const workspace = mkdtempSync(join(tmpdir(), `${basename(root)}-frontend-`));
const templateRoot = join(adapterRoot, "templates/vue");
const layers = [
  {
    path: join(dmsRoot, "frontend-vue"),
    packageName: "@fixture/dms",
    priority: -100,
    options: { dms: { homepage: "/" } },
  },
  {
    path: join(root, "frontend-vue"),
    packageName: `@fixture/${basename(root)}`,
    priority: 0,
  },
];
const excluded = new Set([
  "node_modules",
  "pnpm-lock.yaml",
  ".npmrc",
  "dist",
  ".git",
]);
const environment = { ...process.env };
delete environment.NODE_OPTIONS;

// A page the DMS module itself owns: the SSR bundle has to render one of them
// for the check to exercise the generated renderer end to end.
const ssrRoute = {
  displayName: "Login",
  fullId: "pages.auth",
  fullSlug: "/auth",
  publicAccess: true,
  hasAccess: true,
};
const ssrPage = {
  component: "DmsDynamicPage",
  props: {
    path: "/auth",
    page: {
      route: ssrRoute,
      shared: {
        siteLayout: { pages: { "/auth": ssrRoute }, categories: {} },
        siteLayoutTree: {
          children: {},
          childrenOrders: [],
          fullId: "",
          fullSlug: "/",
          hasAccess: true,
        },
        quickActions: { categories: {}, actions: {} },
        modules: {},
        isOwner: false,
      },
      layout: {
        layout: { componentName: "dms-empty-layout", options: {} },
        components: {
          content: { componentName: "DmsAuthLogin", children: [] },
        },
      },
    },
    errors: {},
  },
  url: "/auth",
  version: "fixture",
};

function readPackage(directory) {
  return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

function prepareWorkspace() {
  for (const file of readdirSync(templateRoot).filter(
    (name) => name !== "npmrc",
  )) {
    cpSync(join(templateRoot, file), join(workspace, file), {
      recursive: true,
    });
  }
  const registry = createFrontendModuleRegistry(workspace, layers);
  let dependencies = {};
  for (const entry of registry.modules) {
    const source = layers.find(
      (layer) => layer.packageName === entry.packageName,
    );
    cpSync(source.path, entry.root, {
      recursive: true,
      filter: (path) => !excluded.has(basename(path)),
    });
    const pkg = readPackage(entry.root);
    dependencies = { ...pkg.dependencies, ...dependencies };
    delete pkg.devDependencies;
    writeFileSync(
      join(entry.root, "package.json"),
      JSON.stringify(pkg, null, 2),
    );
  }
  const pkg = readPackage(templateRoot);
  pkg.dependencies = { ...dependencies, ...pkg.dependencies };
  writeFileSync(join(workspace, "package.json"), JSON.stringify(pkg, null, 2));
  writeFrontendModuleRegistry(workspace, layers);
  writeFileSync(
    join(workspace, "dms-main.css"),
    '@import "tailwindcss";\n@import "@nuxt/ui";\n',
  );
}

function run(args) {
  execFileSync("pnpm", args, {
    cwd: workspace,
    env: environment,
    stdio: "inherit",
  });
}

async function checkSsr() {
  const rendererPath = join(workspace, "dist/ssr/ssr-renderer.js");
  const { renderDmsPage } = await import(pathToFileURL(rendererPath));
  const serverFetch = async (path) => {
    assert.equal(path, "/api/onboarding/informations");
    return { hasAdmin: true };
  };
  const result = await renderDmsPage(ssrPage, serverFetch);
  assert.equal(result.error, undefined);
  assert.equal(result.redirect, "/onboarding");
}

console.log(`Frontend check workspace: ${workspace}`);
prepareWorkspace();
run(["install", "--ignore-scripts", "--no-frozen-lockfile"]);
run(["build"]);
run(["typecheck"]);
await checkSsr();
console.log("Local DMS + Vue adapter: client, SSR and typecheck passed");
if (!process.env.KEEP_FRONTEND_CHECK) {
  rmSync(workspace, { recursive: true, force: true });
}
