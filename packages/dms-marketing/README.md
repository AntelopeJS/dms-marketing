<div align="center">

# @antelopejs/dms-marketing

<a href="https://www.npmjs.com/package/@antelopejs/dms-marketing"><img alt="npm" src="https://img.shields.io/npm/v/@antelopejs/dms-marketing?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="./LICENSE"><img alt="License" src="https://img.shields.io/npm/l/@antelopejs/dms-marketing?style=for-the-badge&labelColor=000000&color=000000"></a>
<a href="https://discord.gg/sjK28QHrA7"><img alt="Discord" src="https://img.shields.io/badge/Discord-18181B?logo=discord&style=for-the-badge&color=000000"></a>
<a href="https://dms.antelopejs.com/docs/modules/marketing"><img alt="Documentation" src="https://img.shields.io/badge/Docs-18181B?style=for-the-badge&color=000000"></a>

First-party marketing analytics for the AntelopeJS DMS: traffic, funnels, A/B splits and heatmaps.

</div>

![The Marketing overview: KPI cards, session quality and the traffic chart against the previous period](https://raw.githubusercontent.com/AntelopeJS/dms-marketing/main/packages/dms-marketing/docs/images/overview.png)

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
| `@antelopejs/dms` | `>=0.9.0 <1.0.0` |
| `@antelopejs/interface-dms` | `>=0.7.0 <1.0.0` |
| `@antelopejs/dms-frontend` (renderer) | `>=0.6.0 <0.7.0` |
| `@antelopejs/interface-dms-marketing` | `>=0.4.0 <0.5.0` |
| `@antelopejs/core` | `>=1.13.5` |
| Database | `@antelopejs/mongodb` `^1.4.2` |

On DMS 0.8, use `@antelopejs/dms-marketing` 0.4.

## Documentation

- [Introduction](https://dms.antelopejs.com/docs/modules/marketing/introduction)
- [Installation](https://dms.antelopejs.com/docs/modules/marketing/installation)
- [Configuration](https://dms.antelopejs.com/docs/modules/marketing/configuration)
- [Usage](https://dms.antelopejs.com/docs/modules/marketing/usage/overview)
- [Extending](https://dms.antelopejs.com/docs/modules/marketing/extending)
- [FAQ](https://dms.antelopejs.com/docs/modules/marketing/faq)
- [Architecture](https://dms.antelopejs.com/docs/modules/marketing/architecture)

The guide's sources live in [`packages/dms-marketing/docs`](https://github.com/AntelopeJS/dms-marketing/tree/main/packages/dms-marketing/docs); [`KNOWN-ISSUES.md`](https://github.com/AntelopeJS/dms-marketing/tree/main/packages/dms-marketing/KNOWN-ISSUES.md) lists the defects found end to end and how each was closed. The module ships the `dms-marketing` Claude Code skill in [`packages/dms-marketing/skills`](https://github.com/AntelopeJS/dms-marketing/tree/main/packages/dms-marketing/skills), declared under `antelopeJs.skills`.

## Contributing

This package lives in the [`AntelopeJS/dms-marketing`](https://github.com/AntelopeJS/dms-marketing) pnpm workspace, next to `@antelopejs/interface-dms-marketing`. Read [CONTRIBUTING.md](https://github.com/AntelopeJS/dms-marketing/blob/main/CONTRIBUTING.md) and the [repository README](https://github.com/AntelopeJS/dms-marketing#contributing) for the development commands.

## License

[Apache-2.0](./LICENSE)
