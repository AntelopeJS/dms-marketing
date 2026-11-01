import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@antelopejs/interface-core/config";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

const DATABASE = "marketing_retention";
const MONGO_VERSION = "8.0.8";
const JWT_SECRET = "marketing-test-secret";
const HTML_RENDER_SECRET = "test-html-render-secret";
let mongo: MongoMemoryReplSet;
let storagePath: string;

/**
 * The backend suite's project: this module from its own build, a published DMS,
 * and the api, auth, storage and mail modules it needs, over an in-memory
 * MongoDB replica set.
 *
 * The module is rebuilt with `pnpm build` unless `DMS_PREBUILT` is set: CI
 * builds once before the suite and sets it, while locally the harness keeps
 * rebuilding so a run always tests the current sources. No frontend server runs
 * here, so the DMS `clientBaseUrl` is the API, whose paths the front proxy
 * serves unchanged; and outside development, which the test run is not, dms
 * 0.10 refuses to start without a render secret of its own
 * (`htmlRender.serviceSecret`).
 *
 * `mongodb` is deliberately a local source, not a package:
 * `tests/retention.test.js` reaches into the running adapter through
 * `@antelopejs/mongodb/dist/connection` to grab the collection the harness
 * connected. A package source materialises a second copy under
 * `.antelope/cache`, so the test would require an unconnected instance and fail
 * with "MongoDB adapter is not connected". The `@antelopejs/mongodb`
 * devDependency pins the version both sides share. Its locked
 * `@antelopejs/interface-database` is the canonical copy the harness checks
 * every module's range against, so it has to meet the floor of the dms release
 * the `dms` range resolves to.
 */
export default defineConfig({
  name: "dms-marketing-test",
  cacheFolder: ".antelope/cache",
  logging: { channelFilter: { "*": "warn" } },
  modules: {
    local: {
      source: {
        type: "local",
        path: ".",
        installCommand: process.env.DMS_PREBUILT ? [] : ["pnpm build"],
      },
    },
    dms: {
      source: {
        type: "package",
        package: "@antelopejs/dms",
        version: ">=0.13.1 <1.0.0",
      },
      config: {
        clientBaseUrl: "http://127.0.0.1",
        auth: { jwtSecret: JWT_SECRET },
        htmlRender: { serviceSecret: HTML_RENDER_SECRET },
        frontend: { bootstrapSecret: JWT_SECRET },
      },
    },
    mongodb: {
      source: { type: "local", path: "node_modules/@antelopejs/mongodb" },
    },
    api: {
      source: { type: "package", package: "@antelopejs/api", version: "1.5.0" },
      config: {
        servers: [{ protocol: "http", host: "127.0.0.1", port: 0 }],
        publicBaseUrl: "http://127.0.0.1",
      },
    },
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "1.0.3",
      },
      config: { secret: JWT_SECRET },
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: "0.1.13",
      },
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: "^0.0.6",
      },
      config: { host: "127.0.0.1", port: 1, secure: false },
    },
  },
  test: {
    folder: "tests",
    async setup() {
      mongo = await MongoMemoryReplSet.create({
        replSet: { count: 1 },
        binary: { version: MONGO_VERSION },
      });
      storagePath = await mkdtemp(join(tmpdir(), "marketing-retention-"));
      process.env.TEST_MONGO_URL = mongo.getUri();
      return {
        modules: {
          mongodb: {
            config: {
              url: mongo.getUri(),
              database: DATABASE,
              options: { monitorCommands: true },
            },
          },
          "file-storage-local": {
            config: {
              storagePath,
              baseUrl: "http://127.0.0.1",
              cleanupInterval: 0,
            },
          },
        },
      };
    },
    async cleanup() {
      await mongo?.stop();
      if (storagePath) {
        await rm(storagePath, { recursive: true, force: true });
      }
      delete process.env.TEST_MONGO_URL;
    },
  },
});
