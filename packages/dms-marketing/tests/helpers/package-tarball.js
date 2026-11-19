const { execFileSync } = require("node:child_process");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const { gunzipSync } = require("node:zlib");
const { z } = require("zod");

const REPO = path.join(__dirname, "..", "..", "..", "..");

const MANIFEST = z.object({
  name: z.string(),
  version: z.string(),
  main: z.string().optional(),
  types: z.string().optional(),
  dmsFrontend: z.string().optional(),
  exports: z
    .object({ ".": z.object({ types: z.string(), default: z.string() }) })
    .optional(),
  antelopeJs: z
    .object({
      implements: z.array(z.string()).optional(),
      skills: z.array(z.string()).optional(),
    })
    .optional(),
  publishConfig: z.object({ access: z.string().optional() }).optional(),
  dependencies: z.record(z.string()).default({}),
  engines: z.record(z.string()).default({}),
});

/** @typedef {z.infer<typeof MANIFEST>} Manifest */

/**
 * A NUL-padded field of a tar header as text.
 *
 * @param {Buffer} tar The archive
 * @param {number} start The field's first byte
 * @param {number} end The byte after it
 * @returns {string} The field
 */
function field(tar, start, end) {
  const text = tar.subarray(start, end).toString("utf8");
  const nul = text.indexOf("\0");
  return nul === -1 ? text : text.slice(0, nul);
}

/**
 * The regular files of a gzipped tar, by path inside the archive.
 *
 * @param {Buffer} gzipped The tarball
 * @returns {Map<string, Buffer>} Each file's bytes
 */
function untar(gzipped) {
  const tar = gunzipSync(gzipped);
  /** @type {Map<string, Buffer>} */
  const entries = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length && tar[offset] !== 0) {
    const name = field(tar, offset, offset + 100);
    const prefix = field(tar, offset + 345, offset + 500);
    const size = Number.parseInt(
      field(tar, offset + 124, offset + 136).trim() || "0",
      8,
    );
    const type = field(tar, offset + 156, offset + 157);
    const start = offset + 512;
    if (type === "0" || type === "")
      entries.set(
        prefix ? `${prefix}/${name}` : name,
        tar.subarray(start, start + size),
      );
    offset = start + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/**
 * Packs one package of the repository with pnpm, as a release does, so workspace ranges are resolved.
 *
 * @param {string} dir The package folder, from the repository root
 * @returns {{ files: string[], manifest: Manifest }} The packed paths, without the `package/` prefix, and the packed manifest
 */
function packed(dir) {
  const folder = mkdtempSync(path.join(tmpdir(), "dms-marketing-pack-"));
  try {
    const output = execFileSync(
      "pnpm",
      ["--config.ignore-scripts=true", "pack", "--pack-destination", folder],
      {
        cwd: path.join(REPO, dir),
        encoding: "utf8",
        shell: process.platform === "win32",
      },
    );
    const tarball = path.join(
      folder,
      path.basename(output.trim().split(/\r?\n/).at(-1) ?? ""),
    );
    const entries = untar(readFileSync(tarball));
    const manifest = parseManifest(
      entries.get("package/package.json")?.toString("utf8") ?? "null",
    );
    return {
      files: [...entries.keys()].map((file) => file.replace(/^package\//, "")),
      manifest,
    };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

/**
 * @param {string} file A file of the repository
 * @returns {string} Its text
 */
function repoText(file) {
  return readFileSync(path.join(REPO, file), "utf8");
}

/**
 * Parses a package manifest, packed or in the repository, keeping the fields the package checks read.
 *
 * @param {string} json The manifest's text
 * @returns {Manifest} The manifest
 */
function parseManifest(json) {
  return MANIFEST.parse(JSON.parse(json));
}

/**
 * @param {string} file A package.json of the repository
 * @returns {Manifest} Its manifest
 */
function repoManifest(file) {
  return parseManifest(repoText(file));
}

module.exports = { packed, repoManifest, repoText };
