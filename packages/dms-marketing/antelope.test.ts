import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@antelopejs/interface-core/config";
import { MongoMemoryReplSet } from "mongodb-memory-server-core";

const DATABASE = "marketing_retention";
const MONGO_VERSION = "8.0.8";
const JWT_SECRET = "marketing-test-secret";
let mongo: MongoMemoryReplSet;
let storagePath: string;

export default defineConfig({
  name: "dms-marketing-test",
  cacheFolder: ".antelope/cache",
  logging: { channelFilter: { "*": "warn" } },
  modules: {
    local: {
      source: { type: "local", path: ".", installCommand: ["pnpm build"] },
    },
    dms: {
      source: {
        type: "package",
        package: "@antelopejs/dms",
        version: ">=0.4.0 <1.0.0",
      },
      config: {
        auth: { jwtSecret: JWT_SECRET },
        frontend: { bootstrapSecret: JWT_SECRET },
      },
    },
    mongodb: {
      // Deliberately a local source, not a package: `tests/retention.test.js`
      // reaches into the running adapter through
      // `@antelopejs/mongodb/dist/connection` to grab the collection the
      // harness connected. A package source materialises a *second* copy under
      // `.antelope/cache`, so the test would require an unconnected instance
      // and fail with "MongoDB adapter is not connected". The
      // `@antelopejs/mongodb` devDependency pins the version both sides share.
      source: { type: "local", path: "node_modules/@antelopejs/mongodb" },
    },
    api: {
      source: { type: "package", package: "@antelopejs/api", version: "1.3.0" },
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
        version: "0.1.5",
      },
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: "^0.0.5",
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
