// Consumers compile against the packed tarball, not the sources, and they are
// spread across the three resolvers with `skipLibCheck: false`. Each one has to
// find the public surface and the `dist/...` form a `moduleResolution: node`
// consumer writes into its own declarations.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
);

const RESOLUTIONS = [
  ["node", "commonjs"],
  ["Node16", "Node16"],
  ["bundler", "preserve"],
];

const CONSUMER_SOURCE = `
import {
  GetClickHeatmap,
  type MarketingHeatmapAnchor,
  type MarketingHeatmapPayload,
  type MarketingHeatmapPoint,
  type MarketingHeatmapQuery,
} from "${manifest.name}";
// The resolved form a \`moduleResolution: node\` consumer emits for a subpath.
import type { MarketingHeatmapPayload as PayloadFromDist } from "${manifest.name}/dist/index";

async function heatmap(): Promise<void> {
  const query: MarketingHeatmapQuery = {
    tenantId: "tenant",
    path: "/pricing",
    period: "7d",
  };
  const payload: MarketingHeatmapPayload = await GetClickHeatmap(query);
  for (const point of payload.points) {
    const anchor: MarketingHeatmapAnchor | undefined = point.anchor;
    void [point.x, point.y, point.weight, anchor?.selector, anchor?.nth];
  }
  void [payload.maxWeight, payload.totalClicks, payload.truncated];
}

const point = undefined as MarketingHeatmapPoint | undefined;
const fromDist = undefined as PayloadFromDist | undefined;

// @ts-expect-error The aggregation grid is internal to the module, not part of the interface.
import type { MarketingHeatmapGrid } from "${manifest.name}";

void [heatmap, point, fromDist];
`;

function runPnpm(args, cwd, { ignoreScripts = false } = {}) {
  const env = { ...process.env };
  if (ignoreScripts) env.npm_config_ignore_scripts = "true";
  return execFileAsync("pnpm", args, { cwd, env });
}

async function main() {
  const temporaryRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "interface-dms-marketing-consumer-"),
  );
  const archivePath = path.join(temporaryRoot, "interface-dms-marketing.tgz");
  const consumerRoot = path.join(temporaryRoot, "consumer");
  fs.mkdirSync(consumerRoot);
  try {
    // No `ignoreScripts`: `prepack` rebuilds `dist`, so the tarball is the
    // current sources rather than whatever was lying around.
    await runPnpm(["pack", "--out", archivePath, "--silent"], packageRoot);
    fs.writeFileSync(
      path.join(consumerRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "interface-dms-marketing-consumer",
          version: "1.0.0",
          private: true,
          dependencies: {
            [manifest.name]: `file:${archivePath}`,
            ...manifest.peerDependencies,
          },
          devDependencies: {
            "@types/node": manifest.devDependencies["@types/node"],
            typescript: manifest.devDependencies.typescript,
          },
        },
        null,
        2,
      )}\n`,
    );
    fs.writeFileSync(path.join(consumerRoot, "consumer.ts"), CONSUMER_SOURCE);
    await runPnpm(["install", "--prefer-offline"], consumerRoot, {
      ignoreScripts: true,
    });

    for (const [moduleResolution, module] of RESOLUTIONS) {
      const configName = `tsconfig.${moduleResolution.toLowerCase()}.json`;
      fs.writeFileSync(
        path.join(consumerRoot, configName),
        `${JSON.stringify(
          {
            compilerOptions: {
              moduleResolution,
              module,
              target: "ES2022",
              strict: true,
              noEmit: true,
              skipLibCheck: false,
              // TypeScript 6 deprecates `node` (node10); consumers on it still exist.
              ...(moduleResolution === "node" && { ignoreDeprecations: "6.0" }),
            },
            files: ["consumer.ts"],
          },
          null,
          2,
        )}\n`,
      );
      await runPnpm(["exec", "tsc", "--project", configName], consumerRoot);
      console.log(`${moduleResolution} resolves the public surface.`);
    }
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

await main();
