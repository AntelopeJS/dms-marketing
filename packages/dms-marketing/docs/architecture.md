# Architecture

How the module is built, and why. Reader-facing feature behaviour lives in
[usage/](usage/); this page is for whoever develops the module or integrates
against its API.

## Data flow

```
client site (tracked website)          DMS admin (Vue 3 / Inertia)
        │  <script tracker.js>                 │
        ▼                                      ▼
POST /api/marketing/collect  ◄──── batched events (sendBeacon)
        │
        ├─► marketing_events              raw, thin, short retention (funnels/heatmaps)
        ├─► marketing_sessions            visit + acquisition context (retention cohorts)
        └─► marketing_website_statistics  daily rollups, one row per website-day (dashboards)

POST /api/marketing/snapshot ◄──── one serialized page rendering per sampled visit the
        │                          backend asked for (GET snapshot.js negotiation),
        │                          or the size of one too large to upload
        └─► marketing_page_snapshots      opt-in, masked, one per (website, path, layout)
```

## Key choices

All inherited from what worked (and failed) in this codebase:

- **Rollups at write time; the overview never reads raw events.** Heatmaps
  and funnel results are the deliberate exceptions: they query the bounded
  raw window, which is why `marketing_events` is kept at all. cms-audit died
  storing raw rows only; the daily-rollup idea comes from dms-api's
  `RouteStatistics`, with one structural departure: one row per website-day
  (`_id` = `websiteId:day`) instead of embedded day arrays, so the scalar
  counters are native server-side increments — concurrent batches, parallel
  instances included, add their deltas instead of overwriting each other
  (`services/rollup-write.ts`). Session quality rides the same increments:
  bounces are counted as transitions (the batch bringing a second pageview
  takes the bounce back) and duration as per-batch extensions, so bounce
  rate, average duration and pages/session all derive from scalars. A day
  also carries the top-N maps, the one part that stays a read-merge-write:
  dynamic keys with cap-based eviction, which no increment can express —
  exit pages lean on that merge to move a session's one exit count between
  pages. Past `TOP_MAPS_RETENTION_DAYS` (90) the
  hourly prune empties the maps and only the scalars keep the full statistics
  retention — nothing is lost that a dashboard could have read, since
  `MAX_QUERY_PERIOD_DAYS` (90) bounds every window. The dimensions themselves
  are declared once, in `TOP_DIMENSIONS` (`src/types/statistics.ts`), which
  drives the write, the trim and the read.
- **Exhaustive capture, no per-route opt-in.** The tracker captures every
  page; sampling only applies to heatmap events (clicks/scrolls), at the rate
  the Settings page publishes.
- **Thin events.** No headers, no bodies, no IP, no user agent in storage.
  The tracker reports an absolute URL, the server stores the path alone: query
  strings are dropped at ingestion (UTM extracted onto sessions) and the
  hostname is only used to tell an internal navigation from an acquisition
  referrer — a referrer matching the website's `domain` or any hostname the
  batch was tracked from is dropped, never counted as a source.
- **Page content only as opt-in snapshots.** The one table holding page
  content is `marketing_page_snapshots`: a website must opt in, form values
  and marked elements are masked before anything leaves the visitor's
  browser, one capture per (website, path, layout) is kept under a
  retention of its own — see *Snapshot contract* and
  [usage/heatmap.md](usage/heatmap.md#page-snapshots). It exists because
  the heatmap needs a backdrop and most production sites refuse to be
  framed; it stays a static, masked rendering, never a recording.
- <a name="anonymous-identity"></a>**Anonymous identity, no cookie.**
  `visitorId = sha256(monthly salt + website + IP + UA)`
  (`services/visitor-id.ts`), computed per request, raw inputs never stored —
  the shape audience-measurement consent exemptions ask for, and what the
  stricter privacy regimes converge on. Session replay (rrweb) is deliberately
  absent: it requires consent. Page snapshots are as far as the module goes
  into page content, and they are opt-in per site.
- **Country without the IP.** With `geoipDatabasePath` configured, the
  collect request's IP resolves to an ISO country code against a local
  MaxMind `.mmdb` file (`services/geoip.ts`) and the code lands on the
  session — the IP itself is still never stored, and no network call is
  made. Opt-in on purpose: the module ships no GeoIP data, so the operator
  who mounts a database (GeoLite2 under its EULA, or a commercial one) is
  the one accepting its licensing terms and owning the compliance analysis.
  Unconfigured, sessions carry no country and the overview hides the card.
- **Acquisition rolled up whole.** All five `utm_*` parameters land on the
  session and each rolls up as its own dimension; `topCampaigns` additionally
  keys full (source, medium, campaign) triples — joined on a control-character
  separator the stats read splits back, so the composite never leaks past the
  storage layer. The channel grouping (direct / organic / social / referral /
  paid) is nothing but a mapping of (referrer domain, `utm_medium`) resolved
  when the session's rollup increment fires (`services/acquisition.ts`) —
  never stored on the session, so the classifier can evolve without a
  migration; sessions rolled up after the change just classify by the new
  rules.
- **Sessions.** A session groups a visitor's events until
  `DEFAULT_SESSION_IDLE_TIMEOUT_MS` (30 min) of inactivity; acquisition
  context (referrer, UTM, device triple) lives on the session so events stay
  thin.

## Tenancy — structural, like the rest of the DMS

Analytics tables (`marketing_events`, `marketing_sessions`,
`marketing_website_statistics`, `marketing_page_snapshots`,
`marketing_funnels`) live in the DMS `dms-tenant` schema — one database instance per tenant, the
same model as dms core and dms-saas — so isolation is the instance boundary,
not a `tenantId` filter someone can forget.

Two tables are global (`dms-core` schema) on purpose:

- `marketing_websites` — the public collect endpoint carries no JWT and needs
  the `websiteId → tenantId` routing step to land the beacon in the right
  instance. This is the ONE surface still scoped by column
  (`src/data-api/tenant-scope.ts`).
- `marketing_settings` — a deployment singleton.

Everything else reads its tenant instance via `GetModel(Model, tenantId)` /
`@TenantScopedModel`.

**Tenant lifecycle contract.** `Hook.TENANT_DELETED` purges every marketing
row of the tenant (instance tables + its websites); `Hook.TENANT_DATA_EXPORT`
contributes websites, funnels and rollups to the workspace
export (`src/hooks`; events, sessions and page snapshots are excluded —
retention-bounded captures, not the durable data a workspace owns). Registered in `construct()`, the dms-saas pattern.

**Website lifecycle contract.** `DELETE /websites/:id` purges the site's
tracking data (events, sessions, rollup, page snapshots) before removing the row
(`services/tenant-website.ts`). Not just hygiene: the retention prune
enumerates tenants through the websites table, so rows left behind by a
tenant's LAST site would outlive every retention pass. Definitions (funnels, their
A/B splits included) are owner-authored and not retention-bound; they stay.

**Retention.** An hourly cron prunes raw events, page snapshots, sessions
and rollup rows past their configured retention and empties the top maps of
rollup rows past the readable window (`src/services/prune.ts`, scheduled in `src/index.ts`).
Every instance runs the pass. Events have immutable timestamps, and rollup
IDs encode an immutable day, so their range cleanup remains valid after
concurrent writes. Clearing old top maps changes no scalar counters.

Sessions and snapshots can become active under the same ID. Their cleanup
reads only expired IDs and dates, then calls `atomicMutation` with
`deleteIfEqual` on the observed `lastSeenAt` or `capturedAt`. The adapter must
compare the date and delete the scoped ID atomically: a predicate in a generic
range-delete statement does not provide this guarantee on every backend.
Date equality suffices for the fixed cutoff; no revision or general ABA
guarantee is required. Only `applied` counts as deletion. `unknown` stops that
cleanup with an error, without retry or an unconditional-delete fallback.

**Integration prerequisite:** the database interface and adapter must implement
`deleteIfEqual`. Validation uses the published database interface 0.1.6,
MongoDB adapter 1.3.0 and the DMS release published at the time, without
source overlays.
`pnpm test` loads the real modules through Antelope and exercises MongoDB with a
disposable database (the first run downloads MongoDB unless
`MONGOMS_SYSTEM_BINARY` is set). Marketing integration tests on PostgreSQL and
RethinkDB remain pending; the MongoDB result is not a portability claim.

## Auth model — two deliberate levels

Module pages (`/modules/marketing/*`) and the `/api/marketing/tables/*`
DataControllers behind them are **platform-owner-only** (`@AuthOwnerOnly`) —
the DMS convention that module surfaces are owner administration spaces. The
REST reads and mutations (`/api/marketing/stats/*`, `/websites`,
`/funnels/:id/results`) are **tenant-scoped**
(`@AuthTenantMember` / `@AuthTenantOwner`): they answer for the caller's tenant claim, so the day a
marketing surface moves to a tenant-reachable category, the API is already
right and only the pages move. Settings stay owner-only at both levels — the
row is deployment-global and drives cross-tenant prunes.

## Event contract

`POST /api/marketing/collect` — public, batched (≤ 25), zod-validated.
Public does not mean unguarded; three checks stand between the endpoint and
the data, each scoped to the misuse it can actually see:

- **Browser origin.** The `Origin` (fallback `Referer`) hostname must be the
  website's `domain`, a subdomain of it, or one of its `extraDomains` —
  otherwise 403. Page script cannot choose these headers, so a tracker
  embedded on a foreign site — the id is public in every tracked page —
  reports that site and is refused, killing cross-site pollution from real
  browsers, deliberate or copy-pasted. Headerless requests pass (old or
  privacy-tooled clients; refusing them would stop no forger), the literal
  `null` of sandboxed frames does not.
- **Declared automation.** Crawlers, CLIs, HTTP libraries, fetchers and
  self-announcing headless engines (ua-parser-js's lists) are dropped
  silently — a 200 counting everything as `dropped`.
- **Per-source rate.** A fixed-window event budget per (website, IP) —
  in-memory, per-instance — caps how fast any single source can write.
  Sized an order of magnitude above a heavy visitor so carrier-grade NAT
  never trips it; refusals are silent 200s for the same reason.

What remains — a scripted client forging a browser UA and a matching Origin
— is accepted as unsolvable for an endpoint that must take anonymous
traffic; no public analytics product authenticates its ingestion. The answer
to that residue is detection and purge (per-site data purge ships; see
*Website lifecycle contract*), not more gating.

Per-event guards run after validation and drop the offending event server-side
(counted, not a 400): oversized `data`, missing `name` on kinds that need one:

```jsonc
{
  "website": "<website id>",
  "events": [
    {
      "kind": "pageview | custom | exposure | click | scroll",
      "url": "https://example.com/pricing?utm_source=newsletter",
      "referrer": "https://example.org/",        // optional
      "title": "Pricing",                        // optional
      "screen": "1920x1080",                     // optional
      "language": "fr-FR",                       // optional
      "name": "signup_submitted",                // required for custom (event name) and exposure (experiment key)
      "data": { "plan": "pro" },                 // kind-specific, ≤ 4 KiB serialized
      "at": 1754500000000                        // optional client ms, ignored past accepted skew
    }
  ]
}
```

Kind-specific `data` payloads:

| Kind | Payload |
|---|---|
| `click` | `{x, y, dx, dy, selector, ox, oy, nth}` — `selector`/`ox`/`oy`/`nth` are the element anchor heatmaps project from: nearest short CSS path, offset inside that element's box 0-1, and its index among the selector's matches. `x`/`y` are viewport-normalized (where on the screen), `dx`/`dy` document-normalized — both are fallbacks, see *Heatmap anchoring* below |
| `scroll` | `{depth}` — max % reached on the page |
| `exposure` | `{experiment, variation}` — the arm the page actually applied; `name` carries the experiment key. The *arm* is declarative: nothing re-derives it, the page is believed. The *key* is not — an exposure for anything but a running split is dropped at ingestion (see *Assignment contract*) |

## HTTP surface

| Route | Auth | Purpose |
|---|---|---|
| `POST /api/marketing/collect` | public | event ingestion |
| `GET /api/marketing/tracker.js` | public | first-party tracker script |
| `GET /api/marketing/experiments.js?website=` | public | per-visitor assignment script for the site's funnels whose A/B split is running (see *Assignment contract*) |
| `GET /api/marketing/snapshot.js?website=&path=&width=` | public | snapshot negotiation: the capture script when the backend wants a snapshot of that path at that viewport width, an empty script otherwise (see *Snapshot contract*) |
| `POST /api/marketing/snapshot` | public | snapshot upload — one serialized page rendering, capped and rate-limited |
| `GET/POST/PUT/DELETE /api/marketing/websites` | tenant member / owner | website CRUD; the list comes back most-recently-active first, so a dashboard landing on the first entry lands on one with data. `snapshotsEnabled` / `snapshotMaskText` are the page-snapshot opt-in and masking options; changing either discards the site's snapshots. `DELETE /:id` purges the site's tracking data with it (see *Website lifecycle contract*) |
| `GET /api/marketing/stats/overview?website=&period=Nd` | tenant member | rollup-backed dashboard read |
| `GET /api/marketing/stats/campaigns?website=&period=Nd&search=&limit=` | tenant member | acquisition read: sessions by channel, UTM campaign table as (source, medium, campaign) triples, top referrers/terms/contents |
| `GET /api/marketing/stats/pages?website=&period=Nd&search=&limit=` | tenant member | inventory of observed paths, plus `heatmapSampleRate` and `trackerEnabled` so the caller can explain an empty heatmap |
| `GET /api/marketing/stats/heatmap?website=&path=&period=Nd` | tenant member | click heatmap (also served through the interface). `website` is optional and merges the tenant's sites when omitted — pass it |
| `GET /api/marketing/stats/snapshot?website=&path=&layout=` | tenant member | the page snapshot the heatmap is drawn over: the capture at that layout, else the nearest one (`exact: false`), else `null`. A document always wins over a row recording an oversize capture, which comes back as `html: null` with the `bytes` it reached |
| `GET /api/marketing/funnels/:id/results?period=Nd` | tenant member | read-time funnel computation — plus, when the funnel carries an A/B split, the per-arm read through the same steps: exposed sessions, conversion, z-test verdicts, SRM check |
| `/api/marketing/tables/funnels/*` | platform owner | funnels DataController (TableView CRUD, tenant-instance-scoped via `@TenantScopedModel`; enforces the split's `draft → running ⇄ stopped` lifecycle, stamps the runs it produces, and freezes key/variations outside draft) |
| `/api/marketing/tables/websites/*` | platform owner | read-only websites DataController (relation picker; global table, column-scoped) |
| `GET/POST /api/marketing/settings` | platform owner | declarative settings form endpoints |

Client sites need no CORS grant: the tracker posts `text/plain` — a
CORS-safelisted type, no preflight — and the backend parses the JSON body
regardless of content type, gating on the browser-stamped `Origin` instead
(see the ingestion guards above). The assignments read keeps the same
property from the other direction: it is served as a **script** the page
loads with `<script src>`, not JSON a page would need CORS to read. The
`@antelopejs/api` CORS configuration only matters for the authenticated
console origins.

## Snapshot contract

Two public routes, guarded like collect (browser origin, declared
automation, per-source rate) and no further:

- **`GET snapshot.js?website=&path=&width=`** answers the capture script
  (`static/snapshot.js`, the site's `maskText` and the byte cap prepended
  as `window.__dmsMarketingSnapshotConfig`) when a capture of (website,
  path, layout-of-width) is wanted, and an empty script in every other case
  — a page has nothing to do with a reason. Wanted means: the site opted
  in, no capture younger than `SNAPSHOT_REFRESH_AGE_MS` (a day) exists, and
  none was handed to another visitor within `SNAPSHOT_PROMISE_TTL_MS` (a
  minute). Both facts live in bounded per-instance caches
  (`services/snapshots.ts`) backed by one key lookup on a miss, so a busy
  page costs the database nothing between captures. Served `no-store`: the
  answer is a decision, not a file.
- **`POST snapshot`** takes the serialized document as `text/plain` JSON
  (no preflight, like collect). The body is read under a hard cap
  (`MAX_SNAPSHOT_BYTES`, 1 MiB) by `services/request-body.ts` — the
  framework's `ReadBody` buffers without one — refusing a declared length
  past it before a byte is read and cutting an undeclared one the moment it
  crosses. Then zod, the origin gate, the bot filter, a per-(website, IP)
  budget of `MAX_SNAPSHOTS_PER_WINDOW_PER_SOURCE` (3) a minute, and a cap of
  `MAX_SNAPSHOTS_PER_WEBSITE` (1000) captures per site. The row is upserted
  by the hash of (website, layout, path) — one per key, replaced in place —
  with the document gzipped. The body is one of two shapes: the capture, or
  — when serializing the page overshot the cap in the visitor's browser —
  `oversizeBytes`, the size it reached. The second writes the same row with
  an empty document and a zero box: a weight, not a rendering. It carries no
  document box on purpose, since a page heavy enough to overshoot the cap
  routinely exceeds `MAX_SNAPSHOT_DOCUMENT_PX` as well, and asking for one
  would refuse the very reports this collects.

The tracker asks only on visits already sampled for clicks (a backdrop is
for pages with clicks), after load, a grace period and in idle time; the
capture script waits for the DOM to stop mutating before serializing. The
serialization rules — what is masked unconditionally, the integrator
markers, the size cap — are in
[usage/heatmap.md](usage/heatmap.md#what-is-and-is-not-captured); the
rendering side is the sandbox described under *Heatmap anchoring*.

Accepted residues:

- **A promise is per instance.** Two instances may each hand a capture to
  one visitor within the same minute; the second upload replaces the first.
  One redundant upload per instance per key per day at worst.
- **A page too heavy to capture says so, once.** Without the report, an
  oversize page was silent: no row, so `wantsSnapshot` elected another
  visitor to serialize it a minute later, forever, and the console could not
  tell it apart from a page never visited. The row holds the key for a
  refresh age like any capture, so the retry is daily and the surface can
  name the weight. What it costs: one of the site's 1000 slots, and a
  backdrop that an oversize report replaces when the page grows past the cap
  between two captures — the next capture under the cap takes it back.
- **A forged capture is a forged page.** A scripted client with a browser
  UA and a matching Origin can upload any document for a path of a site
  that opted in, within the caps — or claim a weight it never had, bounded
  by `MAX_REPORTED_SNAPSHOT_BYTES`, and take that path's backdrop away until
  a real capture replaces it. It renders inert — the console frame runs
  no script, submits no form, navigates nowhere — and the answer is the
  same as for forged events: detection and per-site purge (the heatmap
  reset deletes snapshots too).
- **Retention is bounded by the raw events.** Whatever `snapshotRetention`
  says, the prune uses the shorter of it and `rawEventsRetention`: a
  backdrop that outlives every click it could back is content kept for
  nothing.

## Assignment contract

`GET /api/marketing/experiments.js?website=<id>` answers
`window.__dmsMarketingAssignments={"<experiment key>":"<variation key>"}` for
the site's funnels whose split is `running` — the tracker loads it lazily on the first
`variation()` call. Assignment is a pure function of data already in hand:
`sha256(visitorId:experimentKey)` buckets into the normalized weights
(`services/experiments/assign.ts`), with the visitor id derived from the
request's IP and user agent exactly as collect derives it. Nothing is stored
per visitor; the recorded `exposure` events — not a re-derived assignment —
are what results are computed from, so the analysis survives definition
edits and salt rotation.

The endpoint is public and hardened like the other public surfaces, no
further: definitions are cached per website id in a `BoundedCache` (30 s,
negatives included — an unknown id costs at most one database read per TTL
and answers an empty map, never an error a public page would surface); the
parameter goes through `queryString()` and a length cap before touching the
cache; the global and per-site kill switches short-circuit to the empty map;
the body is `Cache-Control: private, no-store` — per-visitor, so a shared
cache would hand the first visitor's buckets to everyone after it. No origin
gate, no bot filter, no rate limit: those guards protect writes and data
quality at ingestion, and the read has neither — a bot served an assignment
map writes nothing, its exposures die at collect's own guards.

Accepted residues, in the spirit of the collect ones above:

- **The bucket follows the request, not the person.** A visitor changing
  network or browser is a new visitor and may cross arms; two visitors
  behind one NAT sharing a user agent land in the same one. This is what a
  cookieless identity buys and costs. Called from a site's SSR renderer,
  every visitor shares the renderer's identity — the endpoint is
  browser-side by contract.
- **A flood of distinct ids costs a read each.** The negative cache caps
  repetition per id, not invention; past `MAX_CACHE_ENTRIES` within the TTL
  each fresh id is a database read. Collect accepts exactly this (its
  limiter runs after website resolution); the answer is deployment-level
  rate limiting, not a guard invented for one route.
- **The arm an exposure claims is declarative.** Its key is not: collect
  drops any `exposure` whose experiment is not currently running, off the
  same cached definitions the assignment script serves — one read per site
  per TTL, only on batches that carry an exposure. Which arm the page
  applied is still believed, since nothing re-derives it (that is what
  survives salt rotation and definition edits). A forged exposure on a
  running key is a forged custom event by another name; the answer to both
  is detection and per-site purge.
- **The salt rotates monthly, assignments with it.** On the 1st every
  visitor re-draws. Sessions are the analysis unit and a session exposed to
  two arms is excluded, so the statistics stay valid — but a split
  spanning months mixes populations (documented in
  [usage/funnels.md](usage/funnels.md)).
- **Start/stop propagates within the cache TTL per instance.** The writing
  instance invalidates at once; others serve the previous set for up to
  30 s, exactly as deleted-site beacons do. What that window lets through
  never reaches the numbers: results are read over the split's own runs
  (`experiment.runs` on the row — a stop closes one, a resume appends the
  next), so an exposure recorded outside them — a stale instance, a page
  loaded before the stop, a hand-rolled `dmsMarketing.exposure()` call — is
  dropped at read time as well. A resumed split keeps its earlier sessions
  because the arms are frozen and assignment is a pure function of the
  visitor hash: the same visitor draws the same arm across runs, salt
  rotation aside.
- **Running experiment keys are public.** Anyone holding a website id — it
  is printed in every tracked page — can list them. Inherent to serving
  assignments to anonymous visitors; names and non-running splits stay
  behind the authenticated surface.

## Heatmap anchoring

**A click belongs to an element, not to a rectangle.** A document fraction is
not a property of the page. It divides by the document box, and on a page
shorter than the visitor's window that box IS the window: the same button
then arrives with a different `dy` from every window size, which both
misplaces it under the overlay and smears one point of interest across as
many cells as there were window heights. So each click also stores where it
landed *inside the element it hit* (`selector` + `ox`/`oy` + `nth`), and that
is what the overlay projects from and what the rollup buckets on.

Resolving a selector needs the rendered page, and the rendered page is the
snapshot: the console runs `querySelectorAll` against the snapshot document
itself, no round trip. Every way that can fail (no snapshot yet, element
gone, selector now ambiguous) falls back to `dx`/`dy`, which is also all
that clicks captured before anchoring ever had. Blocked elements keep their
id and class for exactly this reason: a click on a masked widget still
resolves to the widget's box.

The rollup caps anchored cells at `MAX_ANCHORED_HEATMAP_CELLS` (2000),
shedding the least-clicked into the document grid: selectors are only as
stable as the page's class names, and a build that hashes them would
otherwise mint a fresh set per deploy until the response grew without bound.
The document grid needs no cap — the 50×50 grid bounds it.

**The snapshot frame.** The console renders the snapshot's HTML in an
`<iframe srcdoc sandbox="allow-same-origin">`: same-origin, so the
document's `scrollWidth`/`scrollHeight` and every anchor box are read
directly (`frontend-vue/app/composables/useSnapshotFrame.ts`) — no message
protocol, no timeout, no silence to diagnose — and nothing else allowed, so
a document that arrived through a public endpoint runs no script, submits
no form and navigates nowhere; `pointer-events: none` on top keeps the
admin's clicks out. The size is still taken from at most ONE reading, with
the frame pinned at the captured viewport height until then: sizing the
frame from a reading taken through it runs away, every `100vh` section
growing one tick at a time. What a live frame could never fix, the
document can: before rendering, the console rewrites the viewport-relative
units of the inlined stylesheets and inline styles (`vh`, `svh`, `lvh`,
`dvh`, `vmin`, `vmax` — declaration values only, a Tailwind arbitrary
value puts `100vh` in the selector too) to the pixels they had in the
visitor's viewport (`frontend-vue/app/utils/snapshotViewportUnits.ts`), so
the one reading is the visitor's page height and the resize changes nothing
inside. `width` matters as much as `height`, since click coordinates are
fractions of the document's `scrollWidth`, not of the frame. The frame's
`color-scheme` follows the visitor's mode at capture, so the page's media
queries resolve the way they did for them.

**Why a snapshot, not the live page.** Framing the live site works only on
sites that allow it, and production defaults (`X-Frame-Options`, CSP
`frame-ancestors`) refuse it without any signal the console can read; a
snapshot is what the visitor actually saw, on any site, whatever rendered
it. The layout question survives it — one capture per (website, path,
layout) with the visitor's viewport bucketed into the console's three
widths (`types/snapshots.ts`), the nearest one reflowed when the asked
layout has none. "Open in a new tab" targets the origin recorded with the
capture; nothing is inferred from `domain`, which is apex-only and
scheme-less.

**Overlay switching.** The click and scroll-depth overlays switch above one
persistent iframe (plain buttons in `PagePreview.vue`), never a declarative
`Tab` block — it unmounts hidden slots by default, which would tear down the
frame and re-measure it on every switch. Later overlays
(per-selector) join the same switch.

**Scroll depth.** A `scroll` event stores the max depth reached per sampled
view — an integer percent of the visitor's *scrollable range*, flushed on
leave and on SPA navigation. A view that never scrolls (every page that fits
its screen included) emits nothing, so the read
(`GET /api/marketing/stats/scroll`, `services/heatmap.ts`) reports a
cumulative reached-at-depth distribution whose denominator is the views that
scrolled, never all views. The overlay
(`frontend-vue/app/components/ScrollDepthOverlay.vue`) anchors depth 0 at the
bottom of the probe viewport: the visitors' real viewports are unknowable
here, so the gradient claims bands, not pixels — and it draws in the pane's
scaled space, where depth only varies vertically and labels keep their font
size at every zoom. Resetting a heatmap deletes clicks and scroll depths
together.

## Inter-module interface

dms-marketing implements `@antelopejs/interface-dms-marketing`
(declared in `antelopeJs.implements`), which exposes the click heatmap to
other backend modules. It has no in-tree consumer since dms-api's tab was
removed; it is kept because every `/modules/` page is platform-owner-only by
DMS design, so the interface is the only route by which a project module can
build a tenant-facing heatmap.

The interface is published as a separate workspace package at
`packages/interface-dms-marketing`, beside this module's own
`packages/dms-marketing`. Local consumers get the workspace link, because
`link-workspace-packages` makes pnpm resolve the module's
`>=<interface version> <1.0.0` dependency to the sibling package. Each package
has its own manually dispatched release workflow, and the module's refuses to
run until the interface version it links is resolvable on npm — so the
interface is always released first.

**Why the heatmap moved here from dms-api.** It used to live in dms-api's
route detail. That was wrong in principle, not in execution: the identifier
dms-api can produce is a *registered backend route*
(`getRegisteredRoutes()`), matched with a strict `eq` against visitor
pathnames, so a location carrying `:id` matches nothing, ever — and its
default preview origin was the DMS API itself, which framed a JSON endpoint.
dms-api no longer consumes the marketing interface.

## Frontend layout

The admin surfaces ship as a DMS frontend module: `frontend-vue/`, a Vue 3
project whose root `dms.frontend.ts` registers every component of
`app/components/` under the `DmsMarketing` prefix and the funnel-steps
DataType plugin, exactly the names the page controllers address. i18n keys
live under `page.marketing.*` (en-GB + fr-FR) in `frontend-vue/i18n/locales/`,
which the loader merges into the console's catalog. `AddFrontendModule`
(`src/index.ts`) publishes the directory to the backend's frontend manifest,
and `ajs dms` materializes it into the generated Inertia workspace it builds
and serves. The five
pages are declared backend-side (`src/pages/`) as DMS page controllers;
Overview, Sources, Tracked pages and Funnels render custom components, Settings is a declarative form shared with its endpoint schema
(`src/pages/settings/form.ts`).

## Phasing

1. **Audience measurement** — shipped: dashboards on rollups, website CRUD.
2. **Funnels & retention** — funnels shipped (read-time compute); session
   cohorts and daily funnel snapshots pending.
3. **A/B** — shipped: server-side deterministic assignment
   (`experiments.js`), exposure capture, and the step-split results read
   (z-test + SRM). The split is a facet of the funnel itself
   (`marketing_funnels.experiment`), scored against the funnel's own steps —
   one definition, one page, no goal to pick. A first cut was withdrawn at
   `cf93e20` — storage and a GrowthBook definitions endpoint shipped without
   CRUD, betting on a client SDK hashing a `visitorId` the client never has;
   the revival assigns server-side instead (see *Assignment contract*).
4. **Heatmaps** — shipped: click and scroll-depth overlays over a page
   snapshot captured by the tracker. A per-selector view is the remaining
   overlay.
5. **Session replay (optional)** — rrweb behind explicit consent, masked
   inputs, short retention, sampled. Not started.

## Known scaffold limits

- Session resolution is serialized per website+visitor on each instance
  (`services/sessionize.ts`), and instances resolve against the database row
  another instance wrote; only simultaneous first hits of one visitor on two
  instances can still open two sessions, and the next idle timeout merges the
  visitor back onto one.
- Rollup scalar counters are native increments and correct across instances;
  the top-N maps are last-write-wins between instances, an approximation the
  maps already accept by evicting on a cap (`services/rollup-write.ts`).
- The collect path resolves websites through a TTL cache
  (`WEBSITE_CACHE_TTL_MS`): after a site is deleted, beacons cached on OTHER
  instances can land for up to the TTL. The deleting instance invalidates
  its own entry immediately.
- Funnel computation is read-time over a bounded raw window
  (`MAX_FUNNEL_EVENTS` = 200 000), and flags `truncated` when the cap is hit
  — verdicts are then withheld, since the truncation keeps the oldest events
  and silently drops the recent ones. A funnel carrying a started split is
  read over the split's runs instead of the selected period, so its results
  are the same whatever period the pane shows and a stopped one is final;
  the read runs one conversion window past the last stop (late goals still
  count), while exposures landing there do not. One fetch spans first start
  to last stop, pauses included — a range scan per run would cost more than
  the rows a pause holds. A long-running split is therefore read over its
  whole life — closer to the cap than a 7-day pane suggests, and still
  bounded by the raw-event retention.
- Split analysis is per session, uncorrected for multiple comparisons
  (k arms each tested against the control at 95%), and bounded by the
  raw-event retention on both sides of the ratio; the per-arm z-test and the
  SRM check answer null rather than a number whenever their approximation's
  validity floor is not met. Resuming a stopped split is allowed and cumulates
  its runs, which puts optional stopping within reach of anyone who reads a
  p-value before deciding — the confirm dialog says so, nothing enforces it.
- Module pages are owner-only by DMS design; customer-facing dashboards must
  land in project pages (phase 1 decision).
- One open defect found end-to-end, in the DMS core's `useForm` — see
  [KNOWN-ISSUES.md](../KNOWN-ISSUES.md).
