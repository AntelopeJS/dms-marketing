# Design v2 port — self-answered grill-me

A grilling session run before the port of `@antelopejs/dms-marketing` to
`@antelopejs/dms` 0.6 / `@antelopejs/interface-dms` 0.4 / `@antelopejs/dms-frontend`
0.5 and to the v2 design mockup (`modules/marketing/*`). Every question was
answered with the recommended option; the answer is the decision the pull
request implements. It exists so a reviewer can check the reasoning behind each
choice without re-deriving it from the diff.

Sources read before the session:

- `@antelopejs/dms` 0.6.0 / `@antelopejs/interface-dms` 0.4.0 changelogs and
  `docs/02.building/13.migration-0-3-to-0-4.md`.
- `@antelopejs/dms-frontend` 0.5.0 changelog and `docs/02.building/08.frontend-layer.md`
  (component naming, auto-imports).
- The block catalogue of interface-dms 0.4 (`base/*`) and the public
  components of the dms-ui layer.
- The mockup: `modules/marketing/{index,acquisition,pages,funnels,funnel,experiment,funnel-new,websites,install,settings,review}.html`,
  the UX review (findings MK-01 to MK-19) included.

---

## 1. Dependencies and breaking changes

**Q1. Which ranges move?**
`@antelopejs/interface-dms` to `>=0.4.0 <1.0.0` (a 0.3 floor would resolve a
copy the 0.6 DMS refuses; the upper bound stays wide, as
`antelopejs-check-interface-ranges` requires, so every module of a project
deduplicates on one copy — the DMS alone caps it below its next minor);
`@antelopejs/interface-data-api` to `>=0.2.0 <1.0.0` (partial edits);
`@antelopejs/core` to `>=1.13.5 <2`; `@antelopejs/mongodb` to `1.4.2` (stores a
`$`-prefixed string as a string — every i18n key we persist starts with `$`);
the frontend module's `engines` to `@antelopejs/dms-frontend >=0.5.0 <0.6.0`;
the playground's `@antelopejs/dms-frontend` to `0.5.0` and `@antelopejs/dms` to
`>=0.6.0 <1.0.0`. The test harness pins the same DMS floor.

**Q2. dms-frontend 0.5 prefixes every registered component and no longer strips
a leading `Dms`. What does the layer change?**
Declare `componentPrefix: "DmsMarketing"` on the frontend module and register
`Overview` instead of `DmsMarketingOverview`. The backend keeps sending the full
name (`DmsMarketingContext`), which is what it already did. DMS components the
templates use (`DmsKpiCard`, `DmsChart`, `DmsPeriodSelector`…) keep their names.

**Q3. Auto-imports are opt-in since dms-frontend 0.4. Do we add a
`dms.frontend.build.ts`?**
No. Every composable and util of the layer is already imported by path, which
keeps the files testable with plain vitest. The DMS's own public composables
(`useToast`, `useConfirm`, `usePeriod`, `registerPeriodScope`, `useChartFetch`…)
stay auto-imported because the DMS declares them.

**Q4. Edit bodies are partial and `null` clears a field (interface-data-api
0.2). Which writes are affected?**
The settings route (`POST /api/marketing/settings`) merges the body into the
stored overrides and reads `null` as "back to the config default" (it already
treated a missing number that way). `funnelsDataAPI` writes go through
`DefaultRoutes.Edit`, which is partial now: the existing "keep the stored
experiment when an edit omits it" fix (#30) stays and is covered by its test.
The website `PUT` already only touched the keys present.

**Q5. `showActions`, `saveBar`, `cancellable` are gone from `Form`.**
The settings form uses `saveMode: "bar"` (the default) and stays a record form.

**Q6. Removed private DMS components (`DmsTable`, `DmsEmpty`, `DmsPageHeader`…)?**
The layer never used them. It used `UAlert`/`USkeleton` for states; those are
replaced by DMS blocks or by `DmsEmptyState`/`DmsBanner`, the public v2
components.

## 2. Page declarations

**Q7. Every page used to be one `CustomComponent("DmsMarketing<Name>View")`.
How far do we move the composition to the backend?**
All the way to the block level: each page is a backend tree of interface-dms
blocks (`Grid`, `KpiCard`, `ChartCard`, `TopListCard`, `Section`, `FieldRow`,
`Form`, `Meter`, `Banner`, `KeyValueList`…), and a custom block only where no
stock block renders the thing (the heatmap, the funnel figure, the A/B verdict,
the website cards, the install guide). Every custom block carries
`.meta({ name: "$page.marketing.blocks.<id>.name", description, icon })`, so
its permission reads as a translated name in the roles tree, never as a
component name.

**Q8. The stock blocks know a period scope, not a website. How does a
`KpiCard` follow the website switcher?**
A marketing context container, `DmsMarketingContext`, wraps the blocks of every
analytics page. It renders the context bar (website switcher with its live
status, period presets, comparison, resolved range, refresh) and its children.
It owns the period through the DMS's `usePeriod` and publishes it under the
`dms-marketing` scope with `registerPeriodScope`; the published `key` also
carries the selected website, so every block bound to the scope refetches when
either changes. The selected website is stored server-side per user
(`marketing_preferences`, written before the scope changes), and every block
route resolves its website as: `website` query parameter, else the caller's
preference, else the most recently active site. Rejected alternatives: a cookie
(the API can live on another origin than the frontend), a watch-action per
block (watches only listen to their own component).

**Q9. Period: keep the "Nd" windows?**
The blocks send `from`/`to` (and `compareFrom`/`compareTo`) from the period
scope; the routes read those and fall back to `period=Nd` for the older
callers. Presets are Today / 7D / 30D / 90D, default 30 days (MK-01), capped at
`MAX_QUERY_PERIOD_DAYS` (90). Comparison is "previous period" by default and can
be turned off; the preset and comparison persist for the browser
(`useDmsCookie`) so they survive navigation between pages.

**Q10. A first run has no website. The stock blocks cannot hide themselves.**
The context container renders the first-run hero (EmptyState-style, with
"Add a website") instead of its children while the tenant has no website, and
an error state with "Try again" when the website list fails. Blocks never fetch
for a tenant without websites.

**Q11. Navigation groups (Analytics / Conversion / Setup)?**
Three URL-transparent categories (`urlSlug: "/"`) under the module root, so the
pages keep their URLs (`/modules/marketing/overview`…) and the sidebar gets the
mockup's headings. Detail pages (funnel report, funnel builder, install guide)
are `hidden` pages reached with a required query parameter.

**Q12. Nav badges ("1 live", "1" pending website)?**
`navBadge` counts on the funnels page (running A/B tests) and the websites page
(websites without any pageview yet). The DMS badge is a count, so "1 live"
reads "1".

**Q13. Permissions: module pages are owner-only. Is `.meta()` still worth it?**
Yes. The ids still exist (`modules.marketing.<page>.<field>`) and appear in the
role preview and the catalog; a translated name costs one locale key.

## 3. Screens (one decision per mockup screen)

**Q14. Overview (MK-02, MK-15, MK-16).**
Four `KpiCard`s (pageviews, sessions, new visitors, custom events; `stat`
variant, delta, sparkline, "vs previous period"), a session-quality strip
(bounce rate inverted, average duration, pages per session) as a scoped
`StatGroup`, the traffic `ChartCard` (sessions/pageviews toggle, previous
period dashed), devices as a `TopListCard` with icons and shares, and four
tabbed top lists (content, acquisition, audience, custom events) whose rows
link to the surface that owns them. Header action: "View funnels".
Not done: Mailing send annotations on the time axis (no dependency on a mailing
module; a later interface can add them) and Export CSV.

**Q15. Acquisition (MK-03, MK-13, MK-17).**
Renamed "Acquisition" everywhere. Channels card with share and change vs the
previous period, a static "How a session gets its channel" `KeyValueList`, the
UTM campaigns table (filter, channel tabs, share, 30-day sparkline, derived
channel, "Missing medium" flag) and three `TopListCard`s (referrers, UTM
contents, UTM terms). A sixth channel, **Email** (`utm_medium` email /
newsletter / e-mail), is classified before the referrer rules. The channel is
resolved when a session's rollup fires, so sessions already rolled up keep the
channel they got. Not done: the link to a Mailing send and the per-campaign
landing pages (new rollup dimension), both listed as follow-ups.

**Q16. Pages & heatmaps (MK-06, MK-07, MK-08).**
One custom block (list + preview share a selection and the URL state). Changes:
one status strip under the toolbar instead of stacked alerts (highest priority
first, each with its own action), a "Most clicked" side list built from the
anchored cells the heatmap already returns, inventory rows with a heat bar, and
an automatic render height. The site-wide reset moves into the header "More"
menu, the per-page reset into the preview's "More" menu, both behind a typed
confirmation that names the domain or path and counts the events.

**Q17. Funnels & A/B (MK-09, MK-10, MK-11, MK-12, MK-19).**
- List: a table with steps, entered sessions, conversion bar, change vs the
  previous period and A/B status, filtered by tabs (All / Funnels / A/B tests).
  A `Banner` surfaces a running test that reached significance. Empty state
  offers templates built from the site's own top pages and events.
- Funnel report page: KPIs (entered, completed, end to end, biggest loss), the
  step figure with "% of entered / % of previous step", "Where to look next"
  and the definition.
- A/B test report page: verdict sentence with lift, confidence and sample size;
  arms keep an identity colour (A neutral, B primary), green and red only on
  the verdict; SRM and truncation warnings above the numbers; Start / Stop
  confirmations that say what freezes.
- Builder page (new and edit): steps with page/event autocomplete and live
  counts, window presets, a live preview, an optional A/B section with weights
  as shares, the `variation()` snippet and a sample-size hint. It writes through
  `funnelsDataAPI`, so the validation stays where it was. A full page instead of
  the stock `Form` because the preview reads the fields as they are typed.

**Q18. Websites and install (MK-04, MK-05).**
A Websites page with one card per site (status, sessions, pages, funnels,
accepted hosts, snapshot and sampling state) and a settings drawer with General,
Capture and Danger zone tabs; deletion lists what goes and asks for the domain.
"Add a website" leads to the install guide, which creates the site, shows the
snippets (HTML, Nuxt, Tag Manager) and polls a connection check that turns
green on the first accepted pageview, or names a refused host with an "Allow
this host" fix. Refused hosts are counted per website in memory with a bounded
cache (the guard already logs them), which is enough for a page that polls
while the developer installs.

**Q19. Settings (MK-14).**
`Section` blocks: Collection (status line and a "Pause collection…" action with
its consequences, out of the form), Retention (the `Form`, with inline
validation that refuses snapshot retention above raw retention instead of
clamping it silently, and the propagation delay in the description), At a
glance (`Meter`s fed by the settings route) and Sampling.

**Q20. Loading and errors (MK-18).**
The stock blocks bring shaped skeletons and in-card errors. Custom blocks use
`DmsEmptyState variant="error"` with "Try again", and keep their data on screen
while a refetch runs.

## 4. Quality

**Q21. What is tested?**
The backend suite keeps its tests and gains tests for the period parser, the
Email channel, the context resolution and the new block routes. The layer
suite keeps its tests (updated for the prefix) and gains tests for the context
key and the formatting helpers. Every page is driven in the playground with a
seeded dataset, in both themes, and screenshotted.

**Q22. What is explicitly out of scope?**
Mailing integration (annotations, linked sends, auto-tagging), Export CSV, and
the per-campaign landing-page rollup. Each needs a contract this module does
not have yet.
