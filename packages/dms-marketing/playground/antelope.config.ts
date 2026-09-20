import { defineConfig } from "@antelopejs/interface-core/config";

const dmsClientUrl = process.env.DMS_CLIENT_BASE_URL;

export default defineConfig({
  name: "playground",
  modules: {
    playground: {
      source: {
        type: "local",
        path: ".",
        installCommand: ["npx tsc"],
      },
    },
    "dms-marketing": {
      source: {
        type: "local",
        path: "..",
        watchDir: ["src"],
        installCommand: ["npx tsc"],
      },
    },
    // Loaded so the playground exercises the console the module ships beside,
    // not because either depends on the other: the heatmap surface is entirely
    // this module's, and dms-api does not consume the marketing interface.
    "dms-api": {
      source: {
        type: "package",
        package: "@antelopejs/dms-api",
        version: ">=0.0.1 <1.0.0",
      },
    },
    dms: {
      source: {
        type: "package",
        package: "@antelopejs/dms",
        version: ">=0.0.1 <1.0.0",
      },
      config: {
        homepage: "/modules/marketing/overview",
        auth: {
          jwtSecret: "dev",
        },
      },
      importOverrides: [],
      disabledExports: [],
    },
    mongodb: {
      source: {
        type: "package",
        package: "@antelopejs/mongodb",
        version: "^1.3.0",
      },
      config: {
        url: "mongodb://localhost:27017",
        database: "playground-dms-marketing",
      },
      importOverrides: [],
      disabledExports: [],
    },
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "^1.0.1",
      },
      config: {
        secret: "dev",
      },
      importOverrides: [],
      disabledExports: [],
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: "^0.1.4",
      },
      config: {
        storagePath: ".antelope/file-storage",
        baseUrl: "http://127.0.0.1:5010",
        defaultVisibility: "private",
      },
      importOverrides: [],
      disabledExports: [],
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: "^0.0.5",
      },
      config: {
        ethereal: true,
      },
      importOverrides: [],
      disabledExports: [],
    },
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "^1.1.3",
      },
      config: {
        servers: [
          {
            protocol: "http",
            port: "5010",
          },
        ],
        cors: {
          allowedOrigins: [
            "http://localhost:3001",
            "http://127.0.0.1:3001",
            /^https:\/\/[^/]+\.onamp\.dev$/,
            ...(dmsClientUrl ? [dmsClientUrl] : []),
          ],
        },
      },
      importOverrides: [],
      disabledExports: [],
    },
  },
});
