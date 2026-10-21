---
name: dms-marketing
description: First-party, cookieless web analytics with the @antelopejs/dms-marketing module of the AntelopeJS DMS. Use when installing or configuring dms-marketing, embedding its tracker on a site, sending custom events or A/B variations from page code (dmsMarketing.track / variation), defining funnels or A/B tests, shipping websites, funnels or demo/migrated history from code (EnsureWebsite / EnsureFunnel / ImportAnalytics), reading heatmaps from another module via GetClickHeatmap, or debugging missing, refused (403/404) or empty analytics.
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

- Marketing 0.5 requires `@antelopejs/dms` >=0.9 (interface-dms 0.7, renderer `@antelopejs/dms-frontend` 0.6);
  0.4 is the DMS 0.8 line.
- `ajs project modules add @antelopejs/dms-marketing`. Options: `trackerEnabled`, `rawEventsRetention`,
  `statisticsRetention`, `snapshotRetention`, `sessionIdleTimeout` (all ms), `heatmapSampleRate` (0-1), `snapshotMaxBytes`,
  `visitorHashSecret` (set it when running several instances), `geoipDatabasePath` (.mmdb, opt-in),
  `dashboardTracking` (see below).
  The Settings page overrides switch, retentions and sampling at runtime for the whole deployment.
- Behind a proxy set the DMS `auth.trustedProxies`; the old `trustedProxyHops` option is gone.
- One website row per tracked site (Websites page or `POST /api/marketing/websites {name, domain, extraDomains?}`).
  Its `domain` gates ingestion: the beacon's Origin must be that apex, a subdomain or an extra host.
- The Websites page is a DMS TableView (cards display, plain grid on offer) over
  `/api/marketing/tables/websites`, whose list answers each row with its card; "Add a website" and a site's
  settings open in modals. Link a site's settings with `/modules/marketing/websites?record=<id>`
  (`&setting=snapshots` scrolls to the snapshot switch).

## Visitor site

```html
<script defer src="https://<dashboard>/api/marketing/tracker.js" data-website-id="<id>"></script>
```

```javascript
window.dmsMarketing?.track("signup_submitted", { plan: "pro" }); // name <= 50 chars, data <= 4 KiB
const arm = await window.dmsMarketing?.variation("hero-cta");      // null = render the control
```

- A site's data is purged, the site kept, with `POST /api/marketing/websites/:id/purge {scope: "heatmaps"|"all"}`
  (tenant owner; settings modal, Danger zone): heatmaps = clicks, scroll depths and snapshots; all = every
  event, session, rollup, snapshot and import. Funnels stay, their results start again from zero.
- The dashboard origin forwards the scripts and beacons because the module declares them `publicEndpoints`
  (renderer 0.6 refuses other cross-origin writes); the backend origin works too.
- Never `type="module"` (breaks `document.currentScript`). Always guard with `?.`.
- Snapshots (heatmap backdrops) are opt-in per site (Websites page, a site's settings modal, General tab, next to Collect data); mask with
  `data-dms-marketing-mask` / `data-dms-marketing-block`. Captures drop transient overlays on their own (top
  layer, fixed/floating role=dialog/menu/listbox/tooltip, fixed toasts and toast viewports); block anything else
  per element. Captures inline only the CSS rules matching the page
  and upload gzipped; cap `snapshotMaxBytes` (default 1 MiB compressed, 64 KiB–8 MiB). One capture per
  (path, layout) a day; a page without a snapshot (reset, option change, retention) is captured at its next
  sampled visit (within 5 min across instances); a refused upload does not count as a capture.
  The pages list shows each path's snapshot age ("No snapshot" when none) from one read per site. The
  preview names the page captured: origin + path, a query string or fragment is never stored. It warns when
  ≥ 10 % (and ≥ 5) of the anchored clicks target elements absent from the snapshot: the page changed, reset it.
- App shells whose document does not scroll (an inner panel does): the tracker and the capture detect the
  largest visible vertical scroller covering half the window; put `data-marketing-scroll-root` on the
  container to name it explicitly. Scroll depth, click `dy` and the backdrop then cover the whole content.

## Tracking the dashboard itself

For a demo, a playground or a back office measuring its own admin, no tag to write:

```typescript
config: { dashboardTracking: { enabled: true, websiteName: "Dashboard", excludePaths: ["/settings/**"],
  snapshots: true } } // snapshots: optional, off by default
```

- Off by default. On, the module's frontend loads the tracker on every signed-in dashboard page and
  `POST /api/marketing/dashboard-tracking` creates one website per tenant on first use (domain = the
  dashboard's host; later hosts join `extraDomains`). Rename or pause it like any site; it is never
  deleted (`DELETE` answers 409): purge its data instead.
- `snapshots: true` provisions it with page snapshots on (text masked) for heatmap backdrops. Config owns the
  switch until a person changes it on the Websites page (`snapshotsSetBy: "owner"`): never re-enabled after.
- `/auth/**` is never counted; signing out pauses the tag, a workspace switch retargets it. SPA navigations
  count. Restart `ajs dms dev` / rebuild the frontend after toggling the option.
- Tracker attributes behind it, usable on any site: `data-exclude-paths="/x,/x/*,/x/**"`, and a live
  `data-website-id` (changing it retargets, removing it pauses).

## Content from code

Never write the module's tables. From a module's `start()` (await) — or unawaited with a `.catch` in
`construct()` / a DATABASE_INITIALIZED handler — use `@antelopejs/interface-dms-marketing`:

```typescript
const tenantId = "default"; // explicit, never implied
await EnsureWebsite({ tenantId, id: "shop-site", name: "Shop", domain: "shop.example.com",
  snapshotsEnabled: true }); // id = data-website-id, global
await EnsureFunnel({ tenantId, id: "shop-quote", websiteId: "shop-site", name: "Quote",
  steps: [{ kind: "url", value: "/pricing" }, { kind: "custom", value: "quote_submitted" }],
  experiment: { key: "hero-cta", status: "running", startedAt: "2026-07-01T00:00:00Z",
    variations: [{ key: "control", weight: 1 }, { key: "bold", weight: 1 }] } });
await EnsurePageSnapshot({ tenantId, websiteId: "shop-site", url: "https://shop.example.com/pricing",
  html, viewport: { width: 1280, height: 800 }, document: { width: 1280, height: 2600 } });
await ImportAnalytics({ tenantId, importId: "shop-history", websiteId: "shop-site", sessions: [
  { visitor: "v1", userAgent, country: "BE", events: [{ kind: "pageview", at: "2026-10-01T09:00:00Z", url }] }] });
```

- Ensure* answer `created` / `unchanged` / `updated` / `kept`: a record someone changed since the last
  declaration (hash stored on the row) is never overwritten; delete it in the dashboard to re-take it.
  Dashboard rules apply (hostnames, 1-10 steps, 2-8 arms, draft → running ⇄ stopped, arms frozen out of draft).
- ImportAnalytics replays through the live collect pipeline with trusted timestamps (same sessions,
  raw events and daily rows); once per importId + website, later calls `in_progress` (first still replaying, counts not final),
  then `skipped` (or `failed`); ≤ 10,000 sessions and
  1,000 events/session per call; drops future, past-retention, invalid and bot events and exposures of
  draft splits. `startedAt` on a running split makes imported exposures count.
- EnsurePageSnapshot: the heatmap backdrop of a page the tracker cannot capture (not online, imported
  history); keyed by path + layout of `viewport` (desktop ≥ 1024, tablet ≥ 600, phone); sanitized like a
  capture (a `<style>` with `<` before a letter, `!`, `/` or `?` is dropped: CSS-escape that character); needs `snapshotsEnabled`; a live capture replaces it and is never overwritten (`kept`).
- `tenantId` is required on every content call: no default. Full contract: the interface package's
  `docs/1.index.md`.

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
