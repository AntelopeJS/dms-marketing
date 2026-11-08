---
name: verify-dms-marketing
description: "Drive the AntelopeJS dms-marketing module (the collector, the tracker, websites, the Overview and Acquisition pages, pages and heatmaps, page snapshots, funnels, A/B tests, settings and content from code) the way a visitor, a platform owner and a member do, inside a DMS with free ports and its own MongoDB database, and report a verdict with evidence. Use to prove a change to AntelopeJS/dms-marketing works before merge, or to verify a PR."
---

# Verify dms-marketing

Every deterministic step is a `dms-control` command. You choose which journeys to run and judge what they show; you never write a multi-step shell recipe. When a journey you need does not exist, add it to `journeys/<feature>.mjs`, describe it in its feature file, and run it.

`dms-control` is the bin of `@antelopejs/dms`, a devDependency of `packages/dms-marketing`. Run it with Node 24 after `pnpm install`, through that package:

```bash
C="pnpm --dir packages/dms-marketing exec dms-control"
$C                       # lists every command
```

Give `doors` and `--skill` absolute paths: the command runs in `packages/dms-marketing`.

## Launch

```bash
RUN=$($C up --prepare --base origin/main)   # installs, builds, starts; prints the run folder
```

`--prepare` runs the `prepare` commands of `verify.config.ts`: the frozen install, the build of the interface and the module, `playwright-core` into this folder, the link of the verification playground's `node_modules` to `packages/dms-marketing/node_modules`, and the TypeScript build of the playground's fixture module. Without it `up` uses the builds already there, and `doctor` fails on a stale one. `up` reads the playground from `verify.config.ts` (`playground/` in this folder: the DMS, the api, MongoDB, auth, file storage and mail modules, the module under verification as a `local` source at `packages/dms-marketing`, and a fixture module of its own) and starts an isolated DMS:

- the checkout is laid out again under `$RUN/root`, every sibling linked, and the playground copied without `node_modules`, so the run's build, `.antelope/` and stored data are its own;
- the API, the dashboard and the mail sink get free ports from the kernel, and `HOME` is `$RUN/home`;
- a `mongod` the run owns serves `verify_<run>` databases;
- the backend runs `ajs project start -e docs`, the dashboard `ajs dms start -e docs -b <api>`.

The fixture module (`playground/src`) serves what a journey cannot do over the module's own HTTP API, under `/verify-marketing`: a member with a role and optionally the tenant owner right (`POST /member`), the interface's content calls with the body passed through unchanged (`POST /website`, `/funnel`, `/snapshot`, `/import`), the heatmap read (`POST /heatmap`), the tenant hooks as the DMS core fires them (`POST /tenant/export`, `/tenant/delete`), the backend's `Date.now()` moved ahead (`POST /clock` with `aheadMs`, for windows the module keeps in memory), and a visitor site (`GET /site/<page>?w=<website id>&attrs=<tag attributes as JSON>&twice=1&module=1&js=<script>`) that loads the tracker from the API's origin, so a real browser can be a tracked visitor of a website whose domain is the API's host.

The module is verified without any external service: it calls none. The one input an operator brings, a MaxMind database, is a local file that the repository does not ship (see Not driven).

## Doctor

```bash
$C doctor "$RUN"          # prints only failing checks; --verbose prints all
```

Do not drive a run that fails doctor.

## Drive

```bash
$C plan --base origin/main   # the diff mapped to features; unmapped surfaces
$C journey "$RUN" smoke
$C journey "$RUN" collect [journey-id...]
```

- Each feature file in [features/](features/README.md) lists its source globs (`covers:`), its docs pages (`docs:`) and its journeys; the journeys are in `journeys/<feature>.mjs` and `journeys/parts/`, with the helpers they share in `marketing.mjs` (requests, checks, `clickUntil`), `site.mjs` (websites, the collector as a browser, `withConfig`, members) and `store.mjs` (the module's stored rows, read and aged with the MongoDB driver dms-control resolves).
- A journey starts on an empty database with the administrator onboarded and the backend restarted on it. It reads every mutation back through a second view: the API, a stored row, a reload, an anonymous request, a member's account, or a backend restart.
- `withConfig(ctx, { <module option>: ... }, body)` restarts the backend with module options set (`VERIFY_MKT_CONFIG`, plus the DMS `auth.trustedProxies` and `auth.clientIpHeader`) and restarts it again without them.
- To look at the product yourself: `$C onboard "$RUN"`, `$C browser "$RUN" login`, `goto --path`, `snapshot`, `click --role --name`, `fill`, `press`, `screenshot`, `$C api "$RUN" <method> <path> [--as anon] [--body <json>]`, `$C reset "$RUN"`. Each writes its evidence under `$RUN/evidence/`.

## Evidence

Everything goes under `$RUN/evidence/`: `<feature>/<journey>/NN-<step>/` with `action.json`, `url.txt`, `aria.yml` and `screenshot.png` for a browser step, `request.json` and `response.json` (status, headers, size and SHA-256 of the body) for a request, and `checks.json` for every step that checks something; `<feature>/<journey>/result.json` and `<feature>/feature.json`. Read the evidence before you judge a PASS: a check passing proves only what it asserts.

## Cleanup

```bash
$C down "$RUN"
```

Run it for every run you started, also after a journey failed or a command stopped halfway: `down` stops the backend, the dashboard, the mail sink and the run's `mongod`, and keeps `$RUN/evidence/`. Write the verdict after `down`, from the evidence.

## Verdict rules

1. **Run every feature whose `covers:` globs the diff touches, plus the smoke journey.** `plan` prints that list as `run`.
2. **Unmapped surface fails the verdict.** User-facing code is `packages/dms-marketing/src/**`, `static/**`, `frontend-vue/**`, `skills/**`, `package.json`, and `packages/interface-dms-marketing/src/**` and `package.json`, tests and tool configs excluded (`verify.config.ts`). `map` checks the whole tree.
3. **Every registered journey of a feature in `run` must have run and passed.**
4. **Docs.** Judge every `docs:` page of each touched feature against what the journeys showed.
5. **Formal checks.** `formal-import-claim` covers the website claim of `ImportAnalytics` and the replay it guards: `$C formal "$RUN"` runs it when the diff touches its files. While its findings stand, it fails a verdict whose diff changes the covered code.
6. **One-way doors.** The section comes right after the result line and is mandatory. `$C doors` prints the `One-way-door:` line for the diff.
7. **Result.** FAIL if any of rules 1 to 6 fail. PASS+NOTES when something is not verified or needs the owner's attention. PASS otherwise.

Write `$RUN/evidence/judgement.json` (`doors`, `docs`, `notVerified`, `attention`, `verifier`), then `$C verdict "$RUN" --pr <n>`, which writes `$RUN/evidence/verdict.md`. Report the verdict and what you saw in your own reply.

## Gotchas

- Every dashboard page renders on the server and hydrates after `load`; a click that lands first does nothing. The journeys click again until what the click opens shows (`clickUntil`), and `tab.signIn` waits for the sign-in form to hydrate.
- The run's headless browser announces itself as `HeadlessChrome`, and the collector drops declared automation: the visitor-site journeys give the browser context a plain Chrome user agent (`journeys/parts/tracker-helpers.mjs`).
- The tracker sends its batches every 5 seconds, so a journey waits for the stored rows (`waitFor`) instead of for time.
- Visitors are told apart by the user agent (the visitor hash is the website, the address and the agent), so journeys that need several visitors give each its own agent.
- Rollups are written after the events: a read of the Overview waits for the figure (`eventually`).
- History of past days comes from `ImportAnalytics` through the fixture (`history`, `split`): no request ages an event, and an import replays through the live pipeline with its own timestamps.
- `mongod` comes from `DMS_CONTROL_MONGOD`, `PATH`, or the mongodb-memory-server cache (`~/.cache/mongodb-binaries`).
- A step whose check fails because the backend or the dashboard stopped answering ends the journey with a `NOT VERIFIED` error and no failing check (`guard.mjs`).
- `trackerEnabled: false` in the module options is not asserted: the master switch is copied into the settings row at the first start, so an option changed after that start has no effect, while the Settings page and the retention options follow the configuration (`dms-marketing-config-tracker-enabled-frozen`, a draft).
- The tenant-owner and platform-owner levels of the access matrix meet in a single-tenant DMS (the owner of the default tenant is the platform owner), so `access/every-route-answers-only-the-roles-its-level-names` lists them together.

## Not driven

List these under `notVerified` in the judgement of every verdict:

- the hourly prune (retention): it runs from a `node-cron` task at the top of the hour and no request, switch or restart runs it; the counts it would delete are driven through the 409 of a destructive retention cut (`settings`);
- the visitor-country dimension from a GeoIP database (`geoipDatabasePath`): the module ships no `.mmdb` file and the repository holds none; countries are driven through the `country` of an imported session;
- the monthly rotation of the visitor salt: it follows the server's clock;
- concurrent `ImportAnalytics` calls on several instances, a holder that stalls or dies, and the takeover of its claim: a run has one instance; `formal-import-claim` checks them (rule 5);
- reading another workspace's dashboard (`?workspace=`): it needs two workspaces with a dashboard website and the DMS core creating a second tenant, which a run does not have; the single-workspace answer (`[]`) is driven;
- a second tenant: isolation between tenants and the platform-owner level apart from the tenant-owner level (see Gotchas);
- the exclusion of the sign-in pages and of `excludePaths` by the dashboard's own tag, and the tracker following sign-out and workspace switches: they run in the dashboard's frontend plugin on dashboard pages outside the module area, which the playground does not have; the collector's refusal of the module area is driven;
- the Format door: no journey writes data with the previous release and reads it with the head, because `withBaseBackend` builds the base ref with this skill's playground and the base ref (`origin/main`) does not hold the skill until this skill is merged;
- the funnel builder and the A/B report in the browser (unsaved-changes guard, duplicate, the sample-size hint, start, stop and resume buttons, the verdict sentence); the funnel and A/B results behind them are driven through the API, and a split goes from draft to running through the interface;
- the heatmap overlay, the legend and the preview's toolbar, the drift strip, and the pixel placement of clicks over a snapshot (the data behind them is driven);
- the install guide's three steps, the Nuxt and Google Tag Manager tabs of the snippet and the copy buttons (the connection check behind them is driven);
- the dashboard's period picker beyond the presets, the calendar, the **L** key and the live toggle's read rate (every block's data for a period and a comparison is driven through the API);
- the module's tracker cache lifetime reaching returning visitors (an hour) and a stale instance serving for the 30-second definitions cache;
- the module `skills/dms-marketing` content beyond shipping: it is read by an agent;
- `ajs project modules add`, `ajs dms`'s renderer range refusal, and the repository playground's commands (developer tooling).

## Feature map

[features/README.md](features/README.md).
