# @antelopejs/dms-marketing

<div align="center">
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&labelColor=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000" alt="Discord"></a>
<a href="https://antelopejs.com"><img src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000" alt="Documentation"></a>
</div>

Marketing analytics module for the AntelopeJS DMS: traffic dashboards,
conversion funnels with optional A/B splits, and click heatmaps, fully
first-party. No external service, no cookie; data stays in the project's
MongoDB.

<p align="center">
  <img src="docs/images/overview.png" alt="The Marketing overview: KPI cards, session quality and the traffic chart" width="900">
</p>

**Documentation: [dms.antelopejs.com/docs/modules/marketing](https://dms.antelopejs.com/docs/modules/marketing)**
(sources in [`docs/`](docs); design notes in [`docs/design/`](docs/design)).

| Feature | Where |
|---|---|
| Traffic overview | `/modules/marketing/overview` |
| Acquisition | `/modules/marketing/acquisition` |
| Pages & heatmaps | `/modules/marketing/pages` |
| Funnels & A/B tests | `/modules/marketing/funnels` |
| Websites & install guide | `/modules/marketing/websites` |
| Settings | `/modules/marketing/settings` |

## Installation

```bash
ajs project modules add @antelopejs/dms-marketing
```

Then embed the tracker on each visitor site:

```html
<script defer src="https://<backend>/api/marketing/tracker.js"
        data-website-id="<website id>"></script>
```

See [Installation](https://dms.antelopejs.com/docs/modules/marketing/installation)
and [Configuration](https://dms.antelopejs.com/docs/modules/marketing/configuration).
[Known issues](KNOWN-ISSUES.md) lists the defects found end-to-end and how each
was closed; none is open.

## Claude Code skill

The package ships the `dms-marketing` skill in [`skills/`](skills), declared
in `package.json` under `antelopeJs.skills`.

## Development

This package is one half of the `dms-marketing` pnpm workspace; run the
commands from the repository root.

```bash
pnpm install --filter @antelopejs/dms-marketing...
pnpm --dir packages/dms-marketing/frontend-vue install
pnpm build      # interface, then tsc
pnpm lint       # oxlint + oxfmt over the backend, eslint over frontend-vue
pnpm typecheck  # tsc over both packages, skipLibCheck off
pnpm knip       # unused dependencies
pnpm test       # backend suite, then the frontend module's vitest suite
```

The admin surfaces ship as a DMS frontend module in `frontend-vue/`: a Vue 3
project whose root `dms.frontend.ts` declares the `DmsMarketing` component
prefix and registers every component of `app/components/` under it, plus its
own i18n catalogs. The pages themselves are declared backend-side as trees
of DMS blocks ([Architecture](https://dms.antelopejs.com/docs/modules/marketing/architecture#frontend-layout)). It is a separate project
with a lockfile of its own, published inside this package's tarball and
materialized by the DMS frontend loader (`ajs dms`) into the console's Inertia
workspace. Its own vitest suite runs through `pnpm test`.

The interface this module implements is the workspace's other package,
`packages/interface-dms-marketing`, published under the same `@antelopejs`
scope. This package implements it, so it caps it below the next minor,
`>=<interface version> <0.<minor+1>.0`, rather than taking the fleet's
`<1.0.0` ceiling: a breaking interface minor never reaches a module that does
not implement it. pnpm links that range to the sibling inside the workspace,
so `pnpm build` builds the interface first.
Each is released on its own from GitHub Actions — `release-interface.yml`
then `release.yml`; the module's workflow refuses to run until the interface
version it links is resolvable on npm.

A full consumer project with a tracked demo site lives under `playground/` —
setup in [Installation](https://dms.antelopejs.com/docs/modules/marketing/installation#3-development-playground).

## License

Apache-2.0
