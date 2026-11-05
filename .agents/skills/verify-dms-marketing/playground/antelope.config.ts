import { defineConfig } from "@antelopejs/interface-core/config";

const preferredApiPort = process.env.PORT ?? "5010";
const dmsClientUrl = process.env.DMS_CLIENT_BASE_URL;

/**
 * The module's options as JSON, set by a journey in the run's environment
 * before it restarts the backend. Unset, the module runs its own defaults.
 */
function marketingConfig() {
  const text = process.env.VERIFY_MKT_CONFIG;
  if (!text) return {};
  const parsed: unknown = JSON.parse(text);
  return parsed instanceof Object ? parsed : {};
}

function numberOrUndefined(text: string | undefined): number | undefined {
  return text === undefined || text === "" ? undefined : Number(text);
}

/**
 * The repository's playground with the ports, origins, secrets and mail
 * `dms-control` sets for a run, a fixture module (`app`) and the module under
 * verification built from the checkout.
 */
export default defineConfig({
  name: "verify-dms-marketing",
  modules: {
    app: {
      source: { type: "local", path: "." },
    },
    "dms-marketing": {
      source: { type: "local", path: "../../../../packages/dms-marketing" },
      config: marketingConfig(),
    },
    dms: {
      source: {
        type: "package",
        package: "@antelopejs/dms",
        version: ">=0.13.1 <1.0.0",
      },
      config: {
        homepage: "/modules/marketing/overview",
        meta: { title: "AntelopeJS Marketing", description: "Marketing verification" },
        auth: {
          jwtSecret: process.env.DMS_JWT_SECRET ?? "dev",
          signInCountry: { database: false },
          trustedProxies: numberOrUndefined(process.env.VERIFY_MKT_TRUSTED_PROXIES),
          clientIpHeader: process.env.VERIFY_MKT_CLIENT_IP_HEADER || undefined,
        },
        htmlRender: {
          serviceSecret: process.env.DMS_HTML_RENDER_SECRET ?? "dev",
          renderEndpoint: dmsClientUrl && `${dmsClientUrl}/api/html/render`,
        },
        apiBaseUrl: "${@api.API_PUBLIC_BASE_URL}",
        clientBaseUrl: dmsClientUrl,
        frontend: { bootstrapSecret: process.env.DMS_BOOTSTRAP_SECRET },
        docsPreview: true,
      },
    },
    mongodb: {
      source: {
        type: "package",
        package: "@antelopejs/mongodb",
        version: "^1.5.0",
      },
      config: {
        url: process.env.MONGO_URL ?? "mongodb://localhost:27017",
        database: process.env.MONGO_DATABASE ?? "verify_dms_marketing",
      },
      importOverrides: [],
      disabledExports: [],
    },
    "auth-jwt": {
      source: {
        type: "package",
        package: "@antelopejs/auth-jwt",
        version: "^1.0.3",
      },
      config: { secret: process.env.AUTH_JWT_SECRET ?? "dev" },
    },
    "file-storage-local": {
      source: {
        type: "package",
        package: "@antelopejs/file-storage-local",
        version: ">=0.1.13 <1.0.0",
      },
      config: {
        storagePath: ".antelope/file-storage",
        baseUrl: "${@api.API_PUBLIC_BASE_URL}",
        defaultVisibility: "private",
      },
    },
    nodemailer: {
      source: {
        type: "package",
        package: "@antelopejs/nodemailer",
        version: ">=0.0.6 <1.0.0",
      },
      config: {
        host: "127.0.0.1",
        port: Number(process.env.DMS_SMTP_PORT ?? "9"),
      },
    },
    api: {
      source: {
        type: "package",
        package: "@antelopejs/api",
        version: "^1.5.0",
      },
      config: {
        servers: [{ protocol: "http", port: preferredApiPort }],
        publicBaseUrl: process.env.DMS_CLIENT_BASE_URL,
        cors: {
          allowedOrigins: [process.env.DMS_CLIENT_BASE_URL ?? "http://localhost:3001"],
        },
      },
    },
  },
});
