# Installation

Two sides to install: the **DMS project** that hosts the module (backend +
admin pages), and each **visitor-facing site** to be tracked (one `<script>`
tag). A third section covers running the module's own development playground.

> Both packages are published publicly on npm under the `@antelopejs` scope,
> like the DMS itself (`@antelopejs/dms`). No registry configuration or token
> is needed.

## 1. Install in the DMS project

### Requirements

- An AntelopeJS project running the DMS (`@antelopejs/dms` >=0.0.1 <1.0.0)
  with its usual companions: `@antelopejs/mongodb` ^1.3.0, `@antelopejs/api`,
  `@antelopejs/auth-jwt`.
- MongoDB — analytics data lives in the project's existing database
  deployment, in the DMS `dms-core` / `dms-tenant` schemas.

### Declare the module

Add `dms-marketing` to the project's `antelope.config.ts`:

```ts
export default defineConfig({
  modules: {
    "dms-marketing": {
      source: {
        type: "package",
        package: "@antelopejs/dms-marketing",
        version: "^0.1.0",
      },
      config: {
        // Optional: absolute path of a MaxMind country database (.mmdb).
        // Enables the visitor-country dimension: the collect IP is resolved
        // locally at ingestion and only the country code is stored. The
        // module ships no GeoIP data — supplying the file (GeoLite2 under
        // its EULA, or a commercial db) is the operator's licensing and
        // compliance decision. Replacing the file takes a restart.
        geoipDatabasePath: "/var/lib/geoip/GeoLite2-Country.mmdb",
      },
    },
    // … dms, mongodb, api, auth-jwt as in any DMS project
  },
});
```

### Allow the tracked sites' origins (CORS)

The collect endpoint is called cross-origin from the visitor sites. CORS is
handled by the `@antelopejs/api` module — add each site origin to its config:

```ts
api: {
  config: {
    cors: {
      allowedOrigins: ["https://www.example.com"],
    },
  },
},
```

### Admin frontend

The admin pages ship as a DMS frontend module inside the package
(`frontend-vue/`), a Vue 3 project whose root `dms.frontend.ts` registers the
components the page controllers address. The module declares it through
`AddFrontendModule`, and the DMS frontend loader
(`@antelopejs/dms-frontend`, CLI `ajs dms`) materializes it into the
generated Inertia workspace: `ajs dms prepare` against a running backend,
`ajs dms dev` to serve the console. Nothing has to be installed alongside
this package — the backend serves the module as an archive. Once up, the
module appears in the sidebar as **Marketing** with four pages: Overview,
Funnels, Tracked pages, Settings.

## 2. Register a website

Every tracked site is a *website* row, and its id is what the tracker embeds.
Add it from the console — **Add a website** on the Overview page, or on the
empty state of any marketing page — with a name and an apex domain; the
**Tracker snippet** button then shows the tag to embed, id included. The
REST API creates the same row with a DMS JWT (tenant owner), and is where
the optional fields below are set:

```bash
curl -X POST https://<backend>/api/marketing/websites \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"name": "Main site", "domain": "example.com"}'
```

- `name` — display name in the dashboards.
- `domain` — the site's apex domain, scheme-less. Classifies referrers (an
  internal navigation is never counted as an acquisition source) **and
  gates ingestion**: a beacon is refused unless the browser-reported Origin
  hostname is this domain, a subdomain of it, or one of `extraDomains`.
  Never used to build URLs.
- `extraDomains` — optional; other hosts the site legitimately serves from
  (another TLD, a staging host, localhost), same apex-or-subdomain rule.
- `snapshotsEnabled` — optional, off by default; lets the tracker capture a
  masked rendering of each tracked page as the heatmap's backdrop. This
  stores page content, unlike anything else in the module — read
  [usage/heatmap.md](usage/heatmap.md#page-snapshots) before enabling it.
  Also switchable from the Tracked pages toolbar. `snapshotMaskText` masks
  every text node of the captures on top of the always-masked form values.

The response carries the website's `_id` — the value for `data-website-id`
below, the one the console's **Tracker snippet** already fills in.

## 3. Install on the visitor site

One tag, before `</body>` or in `<head>`:

```html
<script defer src="https://<backend>/api/marketing/tracker.js"
        data-website-id="<website id>"></script>
```

Optional attributes:

| Attribute | Effect |
|---|---|
| `data-host-url` | override the collect origin (defaults to the script's own origin) |
| `data-heatmap-sample` | 0–1 click/scroll sampling rate for this site; overrides the module setting |
| `data-do-not-track="false"` | ignore the browser DNT signal |

Do **not** load it with `type="module"` — that defeats
`document.currentScript`, and the script cannot find its own attributes.

The tracker is cookieless, batches events, flushes with `sendBeacon`, and
tracks SPA navigations through `history.pushState`/`popstate`. What it
records and the JavaScript API it installs (`window.dmsMarketing.track(…)`)
are covered in [usage/tracking.md](usage/tracking.md). On sites that enable
page snapshots, mark the elements that must never be captured with
`data-dms-marketing-mask` (text masked) or `data-dms-marketing-block`
(replaced by an empty box) — see
[usage/heatmap.md](usage/heatmap.md#what-is-and-is-not-captured).

### Verify

1. Load the site with the browser's network tab open: the tracker script must
   load (a 404 means collection is disabled in
   [Settings](usage/settings.md)), then `POST /api/marketing/collect` must
   answer **200** (a **403** means the page's host is not among the
   website's `domain`/`extraDomains`).
2. Within a minute, the page appears on `/modules/marketing/pages` and the
   overview counts the visit.

## 4. Development playground

The repository ships a full consumer project under
`packages/dms-marketing/playground/`: backend on
`:5010`, DMS console via `ajs dms dev`, and a demo site under
`http://localhost:5010/demo` — a small tracked multi-page site (pricing,
signup, SPA navigation, custom events, a prefilled form and masked elements)
that exercises every capture path with `data-heatmap-sample="1"` so nothing
is left to sampling. Its pages refuse framing (`X-Frame-Options: DENY`),
as production sites do, so the heatmap backdrop is exercised the way real
sites exercise it: through page snapshots, enabled on the seeded website.

```bash
pnpm install --filter @antelopejs/dms-marketing...   # workspace root
pnpm build                       # interface, then tsc → dist/
cd packages/dms-marketing/playground
pnpm install
pnpm dev                         # backend on :5010 (ajs project run -w)
pnpm frontend:dev                # DMS console (ajs dms dev)
```

> **Do not bump `zod` past `~3.24.x`** (pinned in `package.json`). The DMS's
> shared types — data-api column
> schemas, declarative forms — are built against zod 3.24, and 3.25 changes
> the internal type structure they rely on: a routine bump typechecks this
> module in isolation and breaks it against the DMS. The tilde range is
> deliberate; it can only move when `@antelopejs/dms` moves first.

The playground expects a local MongoDB on `mongodb://localhost:27017`
(database `playground-dms-marketing`), overridable through the `MONGO_URL`
environment variable (`MONGO_URL=mongodb://127.0.0.1:27117 pnpm dev`), and
declares CORS for the dev console ports (3000-3002).

The demo site's website row is seeded by the playground itself at first
start (`playground/src/seed.ts` in that project), since the demo pages embed
a fixed `data-website-id`. Funnels over the demo journey are ordinary definitions to
create from the console: `/demo` → `/demo/pricing` → `/demo/signup` → custom
`signup_submitted`.

Lint with `pnpm lint`: oxlint and oxfmt over the backend, then eslint over
`frontend-vue/` (`pnpm --dir packages/dms-marketing/frontend-vue install`
first — the frontend module has a lockfile of its own). `pnpm typecheck`
runs `tsc` over both packages and `pnpm knip` reports unused dependencies;
CI gates on all three. `pnpm test` runs the
backend suite and the frontend module's vitest suite.
