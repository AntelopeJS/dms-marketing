const assert = require("node:assert/strict");
const { packed, repoManifest, repoText } = require("./helpers/package-tarball");

const PACK_TIMEOUT_MS = 120_000;

const INTERFACE_EXPORTS = [
  "GetClickHeatmap",
  "EnsureWebsite",
  "EnsureFunnel",
  "EnsurePageSnapshot",
  "ImportAnalytics",
  "MarketingHeatmapQuery",
  "MarketingHeatmapPayload",
  "MarketingHeatmapPoint",
  "MarketingHeatmapAnchor",
  "MarketingWebsiteDeclaration",
  "MarketingFunnelDeclaration",
  "MarketingFunnelStep",
  "MarketingExperimentDeclaration",
  "MarketingPageSnapshotDeclaration",
  "MarketingPageSnapshotResult",
  "MarketingAnalyticsImport",
  "MarketingImportResult",
  "MarketingImportStatus",
  "MarketingDeclarationResult",
  "MarketingDeclarationStatus",
];

const MODULE_FILES = [
  "skills/dms-marketing/SKILL.md",
  "skills/dms-marketing/cases.json",
  "frontend-vue/dms.frontend.ts",
  "frontend-vue/i18n/locales/marketing-en-GB.json",
  "frontend-vue/i18n/locales/marketing-fr-FR.json",
  "dist/static/tracker.js",
  "dist/static/snapshot.js",
];

describe("what a project installs from the registry", function () {
  this.timeout(PACK_TIMEOUT_MS);

  it("the module's tarball holds the build, the dashboard layer, the agent skill, the bundled browser scripts and every path its manifest points at, without build info or the browser sources", () => {
    const { files, manifest } = packed("packages/dms-marketing");
    const root = manifest.exports?.["."];
    for (const target of [
      manifest.main,
      manifest.types,
      root?.types,
      root?.default,
      manifest.dmsFrontend,
    ]) {
      assert.ok(
        files.includes(String(target).replace(/^\.\//, "")),
        `${String(target)} is packed`,
      );
    }
    for (const file of MODULE_FILES)
      assert.ok(files.includes(file), `${file} is packed`);
    assert.deepEqual(manifest.antelopeJs?.implements, [
      "@antelopejs/interface-dms-marketing",
    ]);
    assert.deepEqual(manifest.antelopeJs?.skills, ["./skills"]);
    assert.deepEqual(
      files.filter(
        (file) => file.endsWith(".tsbuildinfo") || file.startsWith("static/"),
      ),
      [],
    );
    assert.equal(manifest.publishConfig?.access, "public");
  });

  it("the interface's tarball holds its build and its consumer reference, and its root export carries the heatmap read, the four content calls and their types", () => {
    const { files, manifest } = packed("packages/interface-dms-marketing");
    assert.equal(manifest.name, "@antelopejs/interface-dms-marketing");
    for (const file of ["dist/index.js", "dist/index.d.ts", "docs/1.index.md"])
      assert.ok(files.includes(file), `${file} is packed`);
    const declarations = ["index", "content"]
      .map((name) =>
        repoText(`packages/interface-dms-marketing/dist/${name}.d.ts`),
      )
      .join("\n");
    for (const name of INTERFACE_EXPORTS)
      assert.match(
        declarations,
        new RegExp(
          `export (declare )?(function|class|const|interface|type) ${name}\\b`,
        ),
        `exports ${name}`,
      );
  });

  it("the README compatibility table lists the interface ranges the module depends on as packed, its interface-dms-marketing range accepts the interface in the tree, and the dashboard layer pins its renderer minor", () => {
    const table = new Map(
      [
        ...repoText("packages/dms-marketing/README.md").matchAll(
          /^\| `(@antelopejs\/[^`]+)`\s*\| `([^`]+)`/gm,
        ),
      ].map((match) => [match[1], match[2]]),
    );
    const source = repoManifest("packages/dms-marketing/package.json");
    const { manifest } = packed("packages/dms-marketing");
    const interfaces = Object.keys(source.dependencies).filter((name) =>
      name.startsWith("@antelopejs/interface-"),
    );
    assert.ok(interfaces.length > 0, "the module depends on interfaces");
    for (const name of interfaces)
      assert.equal(
        table.get(name),
        manifest.dependencies[name],
        `${name} is in the table with the packed range`,
      );
    assert.equal(
      source.dependencies["@antelopejs/interface-dms-marketing"],
      "workspace:^",
    );
    assert.equal(
      manifest.dependencies["@antelopejs/interface-dms-marketing"],
      `^${repoManifest("packages/interface-dms-marketing/package.json").version}`,
    );
    assert.match(
      repoManifest("packages/dms-marketing/frontend-vue/package.json").engines[
        "@antelopejs/dms-frontend"
      ] ?? "",
      /^>=\d+\.\d+\.\d+ <\d+\.\d+\.0$/,
    );
  });
});
