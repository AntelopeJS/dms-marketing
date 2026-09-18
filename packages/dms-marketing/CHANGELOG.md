# Changelog


## v0.2.2

[compare changes](https://github.com/AntelopeJS/dms-marketing/compare/v0.2.1...v0.2.2)

### 💅 Refactors

- **frontend:** Import the SDK through #dms/frontend-module ([#17](https://github.com/AntelopeJS/dms-marketing/pull/17))

### 🏡 Chore

- Require @antelopejs/core 1.7 ([#16](https://github.com/AntelopeJS/dms-marketing/pull/16))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.2.1

[compare changes](https://github.com/AntelopeJS/dms-marketing/compare/v0.2.0...v0.2.1)

## v0.2.0

[compare changes](https://github.com/AntelopeJS/dms-marketing/compare/v0.1.1...v0.2.0)

### 🩹 Fixes

- **release:** ⚠️  Publish with pnpm and depend on the interface by range ([#13](https://github.com/AntelopeJS/dms-marketing/pull/13))

#### ⚠️ Breaking Changes

- **release:** ⚠️  Publish with pnpm and depend on the interface by range ([#13](https://github.com/AntelopeJS/dms-marketing/pull/13))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.1

[compare changes](https://github.com/AntelopeJS/dms-marketing/compare/interface-v0.1.0...v0.1.1)

### 🏡 Chore

- **release:** Build the interface package before releasing the runtime ([#10](https://github.com/AntelopeJS/dms-marketing/pull/10))
- **release:** Install the frontend module before linting it ([#12](https://github.com/AntelopeJS/dms-marketing/pull/12))

### 🤖 CI

- **release:** Verify the interface the same way dms-mailing does ([#11](https://github.com/AntelopeJS/dms-marketing/pull/11))

### ❤️ Contributors

- Antony Rizzitelli <rizzitelli.antony@pm.me>

## v0.1.0


### 🚀 Enhancements

- Scaffold cms-marketing module with first-party analytics pipeline ([955a3b2](https://github.com/AntelopeJS/dms-marketing/commit/955a3b2))
- **playground:** Split into visitor site and CMS back-office halves ([63df947](https://github.com/AntelopeJS/dms-marketing/commit/63df947))
- **dashboard:** Real Overview visualisations on cms-ui chart primitives ([aaa6b89](https://github.com/AntelopeJS/dms-marketing/commit/aaa6b89))
- **heatmap:** Click heatmap page over a live page preview ([032f510](https://github.com/AntelopeJS/dms-marketing/commit/032f510))
- **funnels:** Funnel definitions, results API and funnel visualisation ([5ea80ea](https://github.com/AntelopeJS/dms-marketing/commit/5ea80ea))
- **interface:** Implement interface-cms-marketing for the heatmap bridge ([9799dfd](https://github.com/AntelopeJS/dms-marketing/commit/9799dfd))
- **funnels:** Declarative CRUD on DataController + TableView ([b18d0e8](https://github.com/AntelopeJS/dms-marketing/commit/b18d0e8))
- **marketing:** Configurable tracker, preview mode and DB access fixes ([24a8ee3](https://github.com/AntelopeJS/dms-marketing/commit/24a8ee3))
- **marketing:** Pages heatmap surface and structural cms tenancy ([8e1122e](https://github.com/AntelopeJS/dms-marketing/commit/8e1122e))
- **heatmap:** Add per-page and site-wide heatmap reset ([cb8cf6c](https://github.com/AntelopeJS/dms-marketing/commit/cb8cf6c))
- **collect:** Gate ingestion on origin, declared bots and per-source rate ([510fc51](https://github.com/AntelopeJS/dms-marketing/commit/510fc51))
- **heatmap:** Move the preview origin to module config ([f781b4d](https://github.com/AntelopeJS/dms-marketing/commit/f781b4d))
- **heatmap:** Make the preview inert and follow the dashboard theme ([2238899](https://github.com/AntelopeJS/dms-marketing/commit/2238899))
- **funnels:** Master-detail layout with generic-form CRUD modals ([596a14c](https://github.com/AntelopeJS/dms-marketing/commit/596a14c))
- **heatmap:** Replace numeric width presets with device icons ([6479a10](https://github.com/AntelopeJS/dms-marketing/commit/6479a10))
- **overview:** Visitor-country dimension from an operator-supplied GeoIP db ([d64ffc5](https://github.com/AntelopeJS/dms-marketing/commit/d64ffc5))
- **overview:** Session-quality KPIs and entry/exit page dimensions ([5138bb8](https://github.com/AntelopeJS/dms-marketing/commit/5138bb8))
- **campaigns:** Full UTM rollup, campaigns view and channel grouping ([7263328](https://github.com/AntelopeJS/dms-marketing/commit/7263328))
- **overview:** TopEvents dimension — custom event names in the rollup ([faa8d22](https://github.com/AntelopeJS/dms-marketing/commit/faa8d22))
- **overview:** TopLanguages dimension from the stored session language ([0133fa8](https://github.com/AntelopeJS/dms-marketing/commit/0133fa8))
- **heatmap:** Scroll-depth overlay over the page preview ([a933a04](https://github.com/AntelopeJS/dms-marketing/commit/a933a04))
- **overview:** Tabbed top-list cards linking to their detail surface ([6c86bc9](https://github.com/AntelopeJS/dms-marketing/commit/6c86bc9))
- **acquisition:** Classify channels from ad click ids ([1d9c357](https://github.com/AntelopeJS/dms-marketing/commit/1d9c357))
- **marketing:** ⚠️  Drop the half-wired A/B experiments surface ([cf93e20](https://github.com/AntelopeJS/dms-marketing/commit/cf93e20))
- **marketing:** Experiment storage, exposure events and assignment engine ([f67f991](https://github.com/AntelopeJS/dms-marketing/commit/f67f991))
- **marketing:** Per-visitor assignments script and tracker variation API ([a9e3f56](https://github.com/AntelopeJS/dms-marketing/commit/a9e3f56))
- **marketing:** Experiments CRUD, lifecycle enforcement and admin page ([cbaf4ef](https://github.com/AntelopeJS/dms-marketing/commit/cbaf4ef))
- **marketing:** Funnel-split experiment results with z-test and SRM ([d613779](https://github.com/AntelopeJS/dms-marketing/commit/d613779))
- **marketing:** Purge and export experiments with the tenant ([46ba719](https://github.com/AntelopeJS/dms-marketing/commit/46ba719))
- **marketing:** Step-grouped experiment results with goal funnel pills ([3f14c5f](https://github.com/AntelopeJS/dms-marketing/commit/3f14c5f))
- **marketing:** Embed experiment goals and redraw the results funnel ([5e477e1](https://github.com/AntelopeJS/dms-marketing/commit/5e477e1))
- **marketing:** Draw classic funnels as the same vertical figure ([903f80a](https://github.com/AntelopeJS/dms-marketing/commit/903f80a))
- **marketing:** Store opt-in page snapshots as the heatmap backdrop ([af5d7b4](https://github.com/AntelopeJS/dms-marketing/commit/af5d7b4))
- **tracker:** Capture a masked DOM snapshot on negotiated sampled visits ([f7d090a](https://github.com/AntelopeJS/dms-marketing/commit/f7d090a))
- **marketing:** Draw the heatmap over the page snapshot ([619c38a](https://github.com/AntelopeJS/dms-marketing/commit/619c38a))
- **marketing:** Stop measuring an A/B split once it is stopped ([b6079f3](https://github.com/AntelopeJS/dms-marketing/commit/b6079f3))
- **marketing:** Let a stopped A/B split be resumed ([23fc6bc](https://github.com/AntelopeJS/dms-marketing/commit/23fc6bc))
- **marketing:** Ask before stopping a split, and say what visitors get ([88a69a9](https://github.com/AntelopeJS/dms-marketing/commit/88a69a9))
- **marketing:** Report a page too heavy to snapshot instead of failing silently ([d13b1a6](https://github.com/AntelopeJS/dms-marketing/commit/d13b1a6))
- **marketing:** Register a website from the console ([7f11d61](https://github.com/AntelopeJS/dms-marketing/commit/7f11d61))

### 🔥 Performance

- **db:** Push prunes and event inserts down to native bulk queries ([35bec87](https://github.com/AntelopeJS/dms-marketing/commit/35bec87))
- **marketing:** Push read-path aggregation into the query layer ([deb5337](https://github.com/AntelopeJS/dms-marketing/commit/deb5337))

### 🩹 Fixes

- **tracker:** Attribute scroll depth to the page it was measured on ([67280cf](https://github.com/AntelopeJS/dms-marketing/commit/67280cf))
- **heatmap:** Resolve websites server-side — a route belongs to one deployment ([d3a98da](https://github.com/AntelopeJS/dms-marketing/commit/d3a98da))
- **auth:** Gate routes with owner and tenant guards instead of AuthRawUser ([36b0671](https://github.com/AntelopeJS/dms-marketing/commit/36b0671))
- **heatmap:** Anchor clicks to the element they hit ([72a2c27](https://github.com/AntelopeJS/dms-marketing/commit/72a2c27))
- **heatmap:** Bound anchored cells and harden the measure channel ([747b9ad](https://github.com/AntelopeJS/dms-marketing/commit/747b9ad))
- **funnels:** Lay steps out on one line and show the step drop-off ([df1a2ea](https://github.com/AntelopeJS/dms-marketing/commit/df1a2ea))
- **rollup:** Serialize daily rollup writes per website ([ab01824](https://github.com/AntelopeJS/dms-marketing/commit/ab01824))
- **websites:** Purge a deleted site's tracking data with it ([e5b3f44](https://github.com/AntelopeJS/dms-marketing/commit/e5b3f44))
- **pages:** Keep a deep-linked path through the immediate watcher run ([3cc4894](https://github.com/AntelopeJS/dms-marketing/commit/3cc4894))
- **rollup:** Recover the insert race by probing state, not driver messages ([f8331bd](https://github.com/AntelopeJS/dms-marketing/commit/f8331bd))
- **rollup:** Store one row per website-day so counters are native increments ([99a8dc7](https://github.com/AntelopeJS/dms-marketing/commit/99a8dc7))
- **sessions:** Serialize resolution per website+visitor ([ba28222](https://github.com/AntelopeJS/dms-marketing/commit/ba28222))
- **cron:** Run the retention prune under a job lock ([277589a](https://github.com/AntelopeJS/dms-marketing/commit/277589a))
- **funnels:** Validate the deep-linked funnel and the delete label ([8bc12fa](https://github.com/AntelopeJS/dms-marketing/commit/8bc12fa))
- **preview:** Rule the empty preview with the theme border token ([5bc4d22](https://github.com/AntelopeJS/dms-marketing/commit/5bc4d22))
- **overview:** Fetch client-side only and let the watcher own the first load ([2814676](https://github.com/AntelopeJS/dms-marketing/commit/2814676))
- **i18n:** Localise backend error messages and count-carrying strings ([2f9bf9b](https://github.com/AntelopeJS/dms-marketing/commit/2f9bf9b))
- **overview,campaigns:** Gate the first render on a skeleton ([bf3c12a](https://github.com/AntelopeJS/dms-marketing/commit/bf3c12a))
- **i18n:** Localise zod validation failures on websites and settings ([2ab5606](https://github.com/AntelopeJS/dms-marketing/commit/2ab5606))
- **playground:** Serve the smoke site so its heatmap has a backdrop ([ece0f59](https://github.com/AntelopeJS/dms-marketing/commit/ece0f59))
- **marketing:** Await the interface implementation in construct ([4775cf1](https://github.com/AntelopeJS/dms-marketing/commit/4775cf1))

### 💅 Refactors

- **heatmap:** Drop the module's heatmap page — cms-api owns the surface ([4a9291b](https://github.com/AntelopeJS/dms-marketing/commit/4a9291b))
- Make constant names carry what their comments explained ([fbcc749](https://github.com/AntelopeJS/dms-marketing/commit/fbcc749))
- Extract shared helpers for dimension records and capped maps ([c2fe3bf](https://github.com/AntelopeJS/dms-marketing/commit/c2fe3bf))
- Use indexed lookups and atomic counter updates ([93a53e1](https://github.com/AntelopeJS/dms-marketing/commit/93a53e1))
- Trim comments to essentials ([75cf50a](https://github.com/AntelopeJS/dms-marketing/commit/75cf50a))
- Extract shared API_BASE_PATH for the /api/marketing prefix ([0cc81e9](https://github.com/AntelopeJS/dms-marketing/commit/0cc81e9))
- Extract MARKETING_MODULE_ID and OVERVIEW_PAGE_ID constants ([60d3e67](https://github.com/AntelopeJS/dms-marketing/commit/60d3e67))
- **tracker:** Drop the stale WritableResponse cast ([2c0e8b4](https://github.com/AntelopeJS/dms-marketing/commit/2c0e8b4))
- **db:** Reach declared indexes with getAll and between ([cf03926](https://github.com/AntelopeJS/dms-marketing/commit/cf03926))
- **heatmap:** Split bucketClicks into per-click helpers ([4d0bcf9](https://github.com/AntelopeJS/dms-marketing/commit/4d0bcf9))
- **heatmap:** Single source for the shared heat ramp ([e1d3601](https://github.com/AntelopeJS/dms-marketing/commit/e1d3601))
- **marketing:** Fold experiments into the funnel they score ([559f097](https://github.com/AntelopeJS/dms-marketing/commit/559f097))

### 📖 Documentation

- Align readme and visitor-id comment with the code ([581cd9b](https://github.com/AntelopeJS/dms-marketing/commit/581cd9b))
- Illustrate the module surfaces and record the open defects ([cf1f383](https://github.com/AntelopeJS/dms-marketing/commit/cf1f383))
- Split the monolithic README into install, usage and architecture guides ([21b70d2](https://github.com/AntelopeJS/dms-marketing/commit/21b70d2))
- Record the website lifecycle contract and close the deep-link defect ([227c359](https://github.com/AntelopeJS/dms-marketing/commit/227c359))
- Record the zod ~3.24.x pin and why it cannot move ([d33e1af](https://github.com/AntelopeJS/dms-marketing/commit/d33e1af))
- **architecture:** Match day-row rollup, serialized sessions, locked prune ([4f8eeb3](https://github.com/AntelopeJS/dms-marketing/commit/4f8eeb3))
- Refresh the screenshots to the current UI and richer demo data ([c651350](https://github.com/AntelopeJS/dms-marketing/commit/c651350))
- Drop changelog-style commentary from comments ([e1341b4](https://github.com/AntelopeJS/dms-marketing/commit/e1341b4))
- **marketing:** Document the A/B experiments revival ([af791fb](https://github.com/AntelopeJS/dms-marketing/commit/af791fb))
- **marketing:** Document the step-grouped experiment read with a screenshot ([365bc0e](https://github.com/AntelopeJS/dms-marketing/commit/365bc0e))
- **marketing:** Reshoot the funnels and experiments screenshots ([c0de139](https://github.com/AntelopeJS/dms-marketing/commit/c0de139))
- **marketing:** Document page snapshots and reshoot the heatmap screenshots ([26f9376](https://github.com/AntelopeJS/dms-marketing/commit/26f9376))

### 🏡 Chore

- Add playground project for end-to-end pipeline testing ([fb49a79](https://github.com/AntelopeJS/dms-marketing/commit/fb49a79))
- **playground:** Load local cms-api to exercise the heatmap bridge ([d101797](https://github.com/AntelopeJS/dms-marketing/commit/d101797))
- Use us spelling and drop real site names ([9166153](https://github.com/AntelopeJS/dms-marketing/commit/9166153))
- Drop dead GrowthBook evaluation and unused HTTP constants ([3d123bb](https://github.com/AntelopeJS/dms-marketing/commit/3d123bb))
- **lint:** Keep biome out of .claude worktrees ([d81da8d](https://github.com/AntelopeJS/dms-marketing/commit/d81da8d))
- **playground:** Refuse framing on the demo site and seed snapshots ([9d2b18a](https://github.com/AntelopeJS/dms-marketing/commit/9d2b18a))
- **marketing:** Make the package installable from the private registry ([6c1f7c2](https://github.com/AntelopeJS/dms-marketing/commit/6c1f7c2))

### ✅ Tests

- **playground:** Add browser demo page for tracker E2E ([472dc46](https://github.com/AntelopeJS/dms-marketing/commit/472dc46))

### 🎨 Styles

- Drop vertical alignment of constant values ([d5f8577](https://github.com/AntelopeJS/dms-marketing/commit/d5f8577))
- Brace every single-line conditional ([6555ee5](https://github.com/AntelopeJS/dms-marketing/commit/6555ee5))

#### ⚠️ Breaking Changes

- **marketing:** ⚠️  Drop the half-wired A/B experiments surface ([cf93e20](https://github.com/AntelopeJS/dms-marketing/commit/cf93e20))

### ❤️ Contributors

- Glastis <glastis@glastis.com>

