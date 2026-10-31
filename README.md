<div align="center">

# @antelopejs/dms-marketing

<a href="https://www.npmjs.com/package/@antelopejs/dms-marketing"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/dms-marketing?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/dms-marketing?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/kxzZMWqdFU"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a>
<a href="https://dms.antelopejs.com/docs/modules/marketing"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

First-party marketing analytics for the AntelopeJS DMS: traffic, funnels, A/B splits and heatmaps.

</div>

![The Marketing overview: KPI cards, session quality and the traffic chart against the previous period](./packages/dms-marketing/docs/images/overview.png)

## What it does

- Shows pageviews, sessions, new visitors and custom events against the previous period, with acquisition channels and UTM campaigns.
- Draws clicks and scroll depth over a snapshot of any tracked page, even on sites that refuse framing.
- Measures ordered conversion funnels with per-step drop-off, optionally split into server-assigned A/B variations.
- Stays first-party and cookieless: no external service, no IP or user agent stored, and the data stays in the project's MongoDB.

## Install

Run the AntelopeJS CLI from the root of a project that already loads `@antelopejs/dms`:

```bash
ajs project modules add @antelopejs/dms-marketing
```

## Quick start

Restart the backend, then the frontend, and open **Modules › Marketing**. Click **Add a website** on the Websites page: the install guide that opens gives the tracker snippet, in HTML, Nuxt or Google Tag Manager form. In HTML:

```html
<script defer src="https://<backend>/api/marketing/tracker.js"
        data-website-id="<website id>"></script>
```

Behind a reverse proxy, set the DMS `auth.trustedProxies` option: see [Installation](https://dms.antelopejs.com/docs/modules/marketing/installation).

## Compatibility

| Package | Version |
| --- | --- |
| `@antelopejs/dms` | `>=0.11.0 <1.0.0` |
| `@antelopejs/interface-dms` | `>=0.9.0 <1.0.0` |
| `@antelopejs/dms-frontend` (renderer) | `>=0.6.0 <0.7.0` |
| `@antelopejs/interface-dms-marketing` | `>=0.5.0 <0.6.0` |
| `@antelopejs/core` (development dependency) | `>=1.16.0 <2` |
| Database (development dependency) | `@antelopejs/mongodb` `1.4.3` |

On DMS 0.8, use `@antelopejs/dms-marketing` 0.4.

## Packages

| Package | Directory | Role |
| --- | --- | --- |
| [`@antelopejs/dms-marketing`](https://www.npmjs.com/package/@antelopejs/dms-marketing) | [`packages/dms-marketing`](./packages/dms-marketing) | The module: tracker, collection, dashboards, funnels and heatmaps. |
| [`@antelopejs/interface-dms-marketing`](https://www.npmjs.com/package/@antelopejs/interface-dms-marketing) | [`packages/interface-dms-marketing`](./packages/interface-dms-marketing) | The interface other modules call to read aggregated analytics. |

## Documentation

- [Consumer reference](./packages/interface-dms-marketing/docs/1.index.md)
- [Introduction](https://dms.antelopejs.com/docs/modules/marketing/introduction)
- [Installation](https://dms.antelopejs.com/docs/modules/marketing/installation)
- [Configuration](https://dms.antelopejs.com/docs/modules/marketing/configuration)
- [Usage](https://dms.antelopejs.com/docs/modules/marketing/usage/overview)
- [Extending](https://dms.antelopejs.com/docs/modules/marketing/extending)
- [FAQ](https://dms.antelopejs.com/docs/modules/marketing/faq)
- [Architecture](https://dms.antelopejs.com/docs/modules/marketing/architecture)

The guide's sources live in [`packages/dms-marketing/docs`](./packages/dms-marketing/docs); [`KNOWN-ISSUES.md`](./packages/dms-marketing/KNOWN-ISSUES.md) lists the defects found end to end and how each was closed. The module ships the `dms-marketing` Claude Code skill in [`packages/dms-marketing/skills`](./packages/dms-marketing/skills), declared under `antelopeJs.skills`.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request. The playground expects MongoDB on `mongodb://localhost:27017` (`MONGO_URL` overrides it) and serves a tracked demo site at `http://localhost:5010/demo`.

Run these commands from the repository root. One install covers the shared tooling, backend, interface and Vue development dependencies, retaining each project's lockfile. The playground remains independent and needs its own install.

```bash
pnpm install
pnpm build          # the interface, then the module
pnpm lint
pnpm typecheck
pnpm knip
pnpm test           # backend suite, then the frontend module's vitest suite
cd packages/dms-marketing/playground
pnpm install --ignore-workspace
pnpm dev            # backend on :5010
pnpm frontend:dev   # dashboard, in a second terminal
```

<details>
<summary>Repository notes</summary>

- The admin pages are declared backend-side as trees of DMS blocks. `frontend-vue/` is a Vue 3 frontend module whose `dms.frontend.ts` declares the `DmsMarketing` component prefix, registers every component of `app/components/` under it, and ships its own i18n catalogs ([Architecture](https://dms.antelopejs.com/docs/modules/marketing/architecture#frontend-layout)).
- The module implements the interface, so it caps its range below the next minor (`>=<interface version> <0.<minor + 1>.0`); pnpm links that range to the sibling inside the workspace. Release `release-interface.yml` first, then `release.yml`, which refuses to run until the interface version it links resolves on npm.
- Do not bump `zod` past `~3.24.x`: the DMS's shared types are built against zod 3.24.

</details>

## License

[Apache-2.0](./LICENSE)
