---
name: dms-marketing
description: First-party, cookieless web analytics with the @antelopejs/dms-marketing module of the AntelopeJS DMS. Use when installing or configuring dms-marketing, embedding its tracker on a site, sending custom events or A/B variations from page code (dmsMarketing.track / variation), defining funnels or A/B tests, reading heatmaps from another module via GetClickHeatmap, or debugging missing, refused (403/404) or empty analytics.
icon: i-lucide-chart-line
category: analytics
tags: [analytics, tracking, funnels, ab-testing, heatmaps, dms-module]
---

# dms-marketing

Traffic dashboards, funnels with optional A/B splits and click heatmaps, all stored in the project's MongoDB.
Pages under `/modules/marketing` (owner-only): overview, acquisition, pages (heatmaps), funnels, funnel,
funnel-builder, websites, install, settings. User docs: `docs/` of this package, published at
https://dms.antelopejs.com/docs/modules/marketing (`architecture` holds the full HTTP and event contracts).

## Setup

- `ajs project modules add @antelopejs/dms-marketing`. Options: `trackerEnabled`, `rawEventsRetention`,
  `statisticsRetention`, `snapshotRetention`, `sessionIdleTimeout` (all ms), `heatmapSampleRate` (0-1),
  `visitorHashSecret` (set it when running several instances), `geoipDatabasePath` (.mmdb, opt-in).
  The Settings page overrides switch, retentions and sampling at runtime for the whole deployment.
- Behind a proxy set the DMS `auth.trustedProxies`; the old `trustedProxyHops` option is gone.
- One website row per tracked site (Websites page or `POST /api/marketing/websites {name, domain, extraDomains?}`).
  Its `domain` gates ingestion: the beacon's Origin must be that apex, a subdomain or an extra host.

## Visitor site

```html
<script defer src="https://<backend>/api/marketing/tracker.js" data-website-id="<id>"></script>
```

```javascript
window.dmsMarketing?.track("signup_submitted", { plan: "pro" }); // name <= 50 chars, data <= 4 KiB
const arm = await window.dmsMarketing?.variation("hero-cta");      // null = render the control
```

- Never `type="module"` (breaks `document.currentScript`). Always guard with `?.`.
- Snapshots (heatmap backdrops) are opt-in per site; mask with `data-dms-marketing-mask` / `data-dms-marketing-block`.

## Other modules

Tenant users cannot open module pages. To show analytics to them, build a project page from DMS blocks
(custom block only for the overlay, with `.meta()`), and read data through the optional interface:
`GetClickHeatmap({ tenantId, path, from?, to?, websiteId? })` from `@antelopejs/interface-dms-marketing`
(declare it in `optionalDependencies`; calls reject without an implementer).

## Gotchas

- Collect `403` = host not declared on the website; `404` = unknown website or its Collect data is off;
  all events `dropped` = collection paused in Settings.
- The tracker script is cached 1 h: settings reach returning visitors within that window.
- Funnels and A/B results read raw events (default 90 days); dashboards read daily rollups only.
- Funnel steps are page paths or custom event names, matched in order within one session and window.
