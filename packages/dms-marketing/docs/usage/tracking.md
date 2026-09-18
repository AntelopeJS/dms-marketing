# Tracker & custom events

The tracker is the script embedded on the visitor-facing site (see
[install.md](../install.md#3-install-on-the-visitor-site) for the embed). This
page covers what it records and the JavaScript API it exposes to page code.

## What is recorded automatically

- **Pageviews** — every page load, plus SPA navigations (the tracker hooks
  `history.pushState` and `popstate`).
- **Clicks and scroll depth** — sampled (10 % of page loads by default; see
  [settings.md](settings.md)). These feed the heatmaps.
- **Page snapshots** — only on websites that opted in, and only on visits
  already sampled for clicks: a serialized rendering of the page, form
  values and marked elements masked, that the heatmap is drawn over. What
  is captured, what never is, and the markers are in
  [heatmap.md](heatmap.md#page-snapshots).
- **Session context** — referrer, screen size, language, and all five
  `utm_*` parameters — source, medium, campaign, term, content — (extracted
  onto the session; query strings are dropped from stored paths). The
  acquisition channel shown on the dashboards is derived server-side from
  referrer + `utm_medium` ([campaigns.md](campaigns.md)).
  When the deployment configures a GeoIP database, the session also carries
  the visitor's country — derived server-side from the request IP, which is
  itself never stored.

Events are batched (up to 25) and flushed with `sendBeacon`, so page unloads
lose nothing. The visitor is identified by a server-side anonymous hash — no
cookie, no localStorage, nothing stored client-side
([architecture.md](../architecture.md#anonymous-identity) has the details).

Server-side, beacons only count when the browser-reported Origin matches the
website's declared domains, and declared bots and machine-rate sources are
dropped silently — [architecture.md](../architecture.md#event-contract)
covers the guard chain.

**Do Not Track** is honoured by default: a browser sending DNT is not
collected unless the embed opts out with `data-do-not-track="false"`.

## Custom events

Page code reports business events through the API the tracker installs:

```js
window.dmsMarketing.track("signup_submitted", { plan: "pro" });
```

- `name` — up to 50 characters; required.
- `data` — optional object, kind-specific, at most 4 KiB serialized. An
  oversized payload is dropped server-side (counted, not a 400).

Custom events show up in the overview's KPI row and its **Top events** card
(counts per name — which CTA gets clicked), and are the second kind of
funnel step ([funnels.md](funnels.md)).

## Experiment variations

`variation()` answers the arm the backend assigned this visitor and reports
the exposure ([funnels.md](funnels.md#splitting-a-funnel-into-ab-variations)):

```js
const arm = await window.dmsMarketing?.variation("hero-cta");
if (arm === "b") {
  showAlternateHero();
}
```

Asynchronous by design — the first call loads the per-visitor assignments
from the backend (nothing is fetched on pages that never ask). A `null`
answer means "render the control": key unknown or not running,
collection off, DNT. The exposure is only reported for the keys the page
actually consulted, once per page load.

`exposure(experiment, variation)` is the low-level escape hatch for
integrations that assign on their own; prefer `variation()`. Either way the
backend only records exposures for a split that is currently running — a
stopped test stops counting, whoever reports the arm.

### Guard the call

`window.dmsMarketing` is installed as a no-op on the paths that collect
nothing (no website id, DNT), **but is absent when the script itself never
runs** — collection disabled serves the script as a 404, and a
`type="module"` embed defeats `document.currentScript`. Page code should
still guard:

```js
window.dmsMarketing?.track("signup_submitted");
```

## Page snapshots

On a visit sampled for clicks, three seconds after `load` and in idle time,
the tracker asks `GET /api/marketing/snapshot.js?website=&path=&width=`
whether the backend wants a capture of this page at this viewport width.
The answer is either empty or the capture script itself, which waits for
the DOM to stop mutating, serializes it, and posts the document to
`POST /api/marketing/snapshot` — or, when the serialization overshoots the
1 MiB cap, posts the size it reached instead, which is what makes the
console say the page is too heavy rather than show nothing. Nothing is
asked on websites that have not opted in, from inside a frame, on a hidden
tab, or past three requests per page load (SPA navigations ask again). The masking rules and the
`data-dms-marketing-mask` / `data-dms-marketing-block` markers are in
[heatmap.md](heatmap.md#what-is-and-is-not-captured); the guards on the
endpoints in [architecture.md](../architecture.md#snapshot-contract).

## Settings reach the tracker with a delay

`GET /api/marketing/tracker.js` prepends the module's effective settings to
the static file, and the response is cached for one hour
(`TRACKER_CACHE_MAX_AGE_SECONDS`). A sampling change on the Settings page
reaches returning visitors within that window.
