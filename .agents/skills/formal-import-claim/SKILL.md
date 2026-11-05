---
name: formal-import-claim
description: TLA+ model of the website claim of ImportAnalytics in @antelopejs/dms-marketing (the claim row `<websiteId>:`, its insert, the token renewal, the 30-poll watch and takeover, ownerFinished) and of the day-by-day replay it guards (the ledger read, the discard of uncounted days, the raw writes, the day commit), checked with TLC. Use when a change touches analytics-import-claim.ts, analytics-import.ts, analytics-import-replay.ts or rollup-write.ts under packages/dms-marketing/src/services, or db/models/marketing_imports.model.ts, or needs proof that concurrent ImportAnalytics calls keep one writer per website and replay a history once.
---

# Formal check: the ImportAnalytics claim and replay

`ImportAnalytics` claims a website by inserting the row `<websiteId>:` into `marketing_imports` with a random `claimToken`. The holder swaps the token every 5 s while it replays. A call that finds the row reads the holder's import row, watches the token for 30 polls of 1 s, and takes the claim over with `swapClaim` when the token never changed. A call that holds the claim and finds the import started resumes it: it deletes the raw rows of the days the ledger (`appliedImports` of the day rows) does not name, then replays those days. A day commits its counters and its ledger entry in one write. The docs promise one writer per website across instances and a history counted once, also when calls race, a holder stalls or dies, and a silent holder is taken over.

The model treats each database round trip as one step. TLC checks every order of those steps across concurrent calls with one import id, a storage failure, a process death, and a live holder that stops for 30 s and resumes, within the bounds below.

- `ImportClaim.tla` holds the variables, the actions and the rules. Each condition carries a `file.ts:NN` comment. Under `packages/dms-marketing/src/`, `claim.ts` is `services/analytics-import-claim.ts`, `import.ts` is `services/analytics-import.ts`, `replay.ts` is `services/analytics-import-replay.ts`, `rollup.ts` is `services/rollup-write.ts` and `model.ts` is `db/models/marketing_imports.model.ts`.
- `Crash.cfg` (a process can die, a live holder renews in time) and `Stall.cfg` (a live holder can stop for 30 s and resume) are the full configurations. Each has a `.ci.cfg` twin.
- `ImportClaim.map.mjs`, `chart-crash.cfg` and `chart-stall.cfg` are for reading results with `/statechart`.

## Run it

From the repository root, with Node 24 and `pnpm install` done (the runner is `@antelopejs/tooling-configs/formal`):

```sh
node .agents/skills/formal-import-claim/check.mjs          # CI configuration
node .agents/skills/formal-import-claim/check.mjs --full   # full configuration
```

Java 11 or later comes from `$JAVA`, else `java` on PATH, else the `eclipse-temurin:21-jre` Docker image (`TLC_DOCKER_PREFIX` names the containers). The first run downloads TLC 1.7.4 into `~/.cache/antelopejs-formal` (or `$XDG_CACHE_HOME/antelopejs-formal`) and checks its SHA-256. Each run checks `Crash`, then `Stall`.

| Configuration | Calls and days (Crash, Stall) | States of the rules that hold (Crash, Stall) | Wall time |
| --- | --- | --- | --- |
| CI (`<config>.ci.cfg`) | 3 and 1, 2 and 1 | 15,958, 2,281 | 22.9 s |
| Full (`<config>.cfg`) | 3 and 2, 3 and 2 | 19,391, 2,586,486 | 65.1 s |

Every configuration allows one storage failure; `Crash` allows one process death. The times are one run each in Docker Java 21 on a shared 16-core machine with a load average near 60.

- Exit 0 means every rule that held still holds, and each finding still breaks with its recorded counterexample length.
- Exit 1 means a rule changed. `BROKEN` names a rule that held and now breaks. `CHANGED` names a finding whose shortest counterexample changed length. `HOLDS` names a finding that no longer breaks. The script prints the folder where it kept TLC's output. The run stops at the first configuration that changed.
- Exit 2 means TLC or Java could not run, or the arguments were wrong.

The lines that name a changed rule match `^(?:BROKEN|CHANGED|HOLDS) +(\w+)`. A rule that still holds prints in a lowercase `holds` line.

A recorded finding is judged by the length of its shortest counterexample alone, so a change that adds a longer path to it exits 0. `$C formal` of `verify-dms-marketing` closes that gap for a diff: while a finding stands, it fails a verdict whose diff changes the covered code.

## When to run it

Run `--full` when a change touches a file in the coverage record or this folder. `verify-dms-marketing` runs it through `$C formal "$RUN"` (rule 5 of its verdict). CI runs the CI configuration on every push and pull request (job `formal-import-claim`, in the `ubuntu` gate).

## The rules

| Rule | Plain sentence | Harm when it breaks | Crash (CI, full) | Stall (CI, full) |
| --- | --- | --- | --- | --- |
| `OneWriter` | At most one call is about to delete uncounted rows, store a day's rows or commit a day. | Two writers count a day twice or delete each other's rows. | F1 (31, 34) | F3 (16, 16) |
| `CountedOnce` | A day's counters and ledger entry are committed at most once. | The Overview and Acquisition counts of the day are doubled, and no resume undoes it. | holds | F3 (22, 22) |
| `StoredOnce` | Once no call runs, a counted day's raw events and sessions come from one replay. | Funnels, heatmaps and hourly traffic, which read raw events, count the day twice for good. | holds | F3 (27, 28) |
| `NothingLost` | Once no call runs, an import that says done has every day counted and stored. | The rollup counts visits whose events and sessions are gone for good. | holds | F4 (26, 29) |
| `DoneStaysDone` | A completed import stays done. | Its caller gets "failed part-way", and other import ids are refused until the id is called again. | F1 (18, 21) | F1 (18, 21) |
| `CallsAnswer` | A call that met no storage failure answers `imported`, `in_progress` or `skipped`. | The caller gets a duplicate-key error or "failed part-way" for an import that is running or complete. | F2 (13, 13) | F2 (13, 13) |

`TypeOK` holds too. The numbers in brackets are the states of TLC's shortest counterexample, which `check.mjs` records per configuration. A liveness rule (every call returns) is out of reach of the shared runner.

## Findings at the sync commit

Each finding was replayed on `packages/dms-marketing/dist` built at the sync commit, inside `ajs module test` with the backend suite's DMS and MongoDB 8.0.8, one database call per model action in TLC's order (see Real bug or modeling error). The replay was a scratch test file and is not committed. The findings are not filed.

- **F1. ownerFinished deletes a live holder's claim (claim.ts:128-129).** A call that cannot insert the claim reads the holder's import row. When that row says done, it deletes the claim with the token it read, also while the holder sits between `update(done)` (import.ts:349-354) and `claim.release()` (line 355). The holder's release then finds no row, `releaseClaim` throws "Analytics import claim release was not confirmed" (model.ts:72-74), and its catch marks the complete import failed (import.ts:358-360). The replay of the 18-state path logged `after MarkFailed: {"importRow":"failed",...,"ledgerEntries":1}` and c1 `{"rejects":"... failed part-way; call it again to resume: Analytics import claim release was not confirmed"}`. When c2 reads the import row before c1 marks it failed, c2 answers `skipped` and the row ends `failed`. With three calls (31 and 34 states), the import row still says done after c2 inserted a new claim, so c3 deletes c2's live claim too, and both resume: the replay logged `waiting: c1 at release claim, c2 at discard, c3 at discard`. The ledger names every day by then, so no data rule breaks in these bounds.
- **F2. A racing call rethrows the insert's duplicate-key error (claim.ts:125-126).** The call's insert fails on the holder's row, the holder releases, and the call's read finds no row, so `if (!owner?.claimToken) throw failure` rejects with the insert error. The replay logged c2 `{"rejects":"Duplicate key on index \"_id\" (_id)"}` after the holder's storage failure (13 states) and after a holder that completed normally (`chart-crash`, 14 steps). Under `Stall`, a taker whose import-row insert (import.ts:333) loses to the stalled holder's rejects with the same error (`chart-stall`, 13 steps).
- **F3. The replay's writes are not fenced by the claim (replay.ts:157-166, 276-281).** `isHeld()` is read once before each visitor, and only the 5 s renewal clears it. A holder that stops after that read for 30 s is taken over, and when it resumes it stores the day's rows and commits the day. The commit appends a ledger entry even when the day row already names the import (rollup.ts:150-155). A holder with no day left marks the import done after its renewal found the claim gone. Replays: `CountedOnce` logged `after the second Commit: {"days":[{"pageviews":2,"sessions":2,"ledgerEntries":2}],"rawEvents":1}` for one pageview. `StoredOnce` (27) ended `{"importRow":"done","days":[{"pageviews":1,"sessions":0,"ledgerEntries":1}],"rawEvents":2}`. Its 28-state path ended with both calls failed and `"rawEvents":2`, and a later call resumed to `done` with day 1 still at two events. On the `chart-stall` path, c1 logged `Renew c1: swap claim -> undefined`, then committed, marked done and returned `{"answer":"imported"}`, and c2 committed the day again: `"pageviews":2,"ledgerEntries":2,"rawEvents":2`.
- **F4. A holder that knows it lost the claim still deletes rows (import.ts:317-334, replay.ts:257-262).** Nothing reads `isHeld()` between the acquisition and the first visitor. A call whose renewal found another token still sets the import row running, reads the ledger and runs `discardUncommitted`, which deletes the rows its taker just stored. Its check then throws, and its catch marks the import failed under the taker, who commits the day and marks it done. The replay (26 states) ended `{"importRow":"done","days":[{"pageviews":1,"sessions":1,"ledgerEntries":1}],"rawEvents":0,"rawSessions":0}`; the 29-state path the same with day 2 intact.

`Stall` stands for any holder whose token stays unchanged for 30 s of the watcher's polls while it can still write afterwards: a paused process (a GC pause, a frozen VM or container, a debugger), or renewals that fail or hang (a failed swap is logged and the old token kept, and later renewals queue behind a hung one) while the replay's own writes go through.

## Read every result with /statechart

Read each TLC result with the pstack `/statechart` skill. Work on a copy of `ImportClaim.tla`, the map and the chart configs in a scratch folder outside the repo, since it writes its output next to its input. Use `ImportClaim.map.mjs` as the view: one region each for the claim row, the import row and the history, and one per call. `chart-crash.cfg` (two calls, one day, one death, no storage failure) reaches 686 states and draws the bug paths in 20 states and 18 arrows: `CallsAnswer` in 14 steps and `DoneStaysDone` in 17, while `OneWriter`, `CountedOnce`, `StoredOnce` and `NothingLost` hold. `chart-stall.cfg` (two calls, one day, stalls, no storage failure) reaches 2,494 states and draws its four bug paths in 41 states and 55 arrows: `OneWriter` in 15 steps, `CountedOnce` in 21, `NothingLost` in 25 and `StoredOnce` in 28. Read the report's numbered paths before the chart. The view hides `Settled`, the step that changes nothing once nothing else can happen. A new bug shows as a new numbered path, and a fix shows which paths it removes.

## Real bug or modeling error

Instances share only the database, and Node runs other work at every `await`, so database calls of different calls interleave in any order the model allows. A `Stall` holder takes no step while 30 polls pass. A step order is a modeling error when the code cannot produce it, for example a watcher that gives up under `Crash` on a holder that still runs, or a resume that reads the ledger before its import row.

Replay a counterexample against the built module. Put a scratch test in `packages/dms-marketing/tests/`, run `pnpm --dir packages/dms-marketing build`, then `DMS_PREBUILT=1 pnpm exec ajs module test . -f tests/<file>.test.js` from `packages/dms-marketing`, and delete the file and the `antelope-lock/` folder the harness writes. Run each call in its own `AsyncLocalStorage` context, and wrap with `mock.method` the calls the actions make: `get`, `insert`, `update`, `swapClaim` and `releaseClaim` of `MarketingImportsModel.prototype`, `getDaysSince` of `WebsiteStatisticsModel.prototype` (the ledger read), `listImported` of `MarketingEventsModel.prototype` (the discard), `ingestPreparedBatch` of `dist/services/collect` (the raw write) and `commitImportedDay` of `dist/services/rollup-write` (the commit). Each wrapped call waits until the replay releases it. An action with no database call, such as `ReadLedger` and `Check` of a new import, runs with the release before it. Capture the 5 s `setInterval`, so a holder renews only when the replay runs its callback (`Renew`); that is how a holder stalls. Make `setTimeout` of `node:timers/promises` resolve at once for 1,000 ms, so `GiveUp` is 30 released reads of the claim row. Give each day one visitor with one pageview, so a day is one raw write. Assert only what the database holds and what each call returns. If the replay does not reproduce a finding, treat the model as wrong until you show it is not.

## Changing the model

- For an intended code change, edit the action that maps to that code, keep the `file.ts:NN` comment on each condition and update its line, then run both configurations.
- Never weaken or drop a rule to make the check pass. A fixed finding leaves `CONFIGS` in `check.mjs`, for every configuration, once a replay confirms the fix. A new finding goes in with its counterexample length for each configuration, and into this file with its replay.
- When you change the bounds of a `.ci.cfg`, rerun the scratch changes below on it. The CI configuration must still catch each one it catches today.
- After you confirm that the model describes the code at a newer commit, move the sync commit forward. Do it only then.

## Coverage record

| Model action | Code |
| --- | --- |
| `Begin` | the import row read, `skipped` for a done import (import.ts:273-276, 192-211) |
| `InsertClaim` | the plain insert of the claim row (claim.ts:120-121) |
| `ReadOwner`, `OwnerFinished`, `ReleaseOwner` | the owner read and its rethrow, `ownerFinished` and its release (claim.ts:125-133, 81-87, model.ts:64-75) |
| `Poll`, `GiveUp`, `TakeOver` | `watchClaim` (claim.ts:64-75) and the takeover swap (lines 133-137, model.ts:46-61), `in_progress` (import.ts:303-306) |
| `Renew` | `holdClaim`'s interval: swap, then a read that clears the token (claim.ts:24-50) |
| `ReadCurrent`, `WriteRow`, `ReleaseSkip`, `ReleaseErr` | the import row read, update or insert, and the first catch (import.ts:316-338) |
| `ReadLedger`, `Discard` | `readLedger` and `discardUncommitted` (replay.ts:257-262, 196-243) |
| `Check`, `WriteRaw`, `Commit` | the per-visitor `isHeld()` check and replay (replay.ts:155-173), the day commit (lines 267-282, rollup.ts:121-157, 183-193) |
| `MarkDone`, `Release`, `MarkFailed`, `ReleaseFailed` | done, release, and the second catch (import.ts:340-366), `release()` (claim.ts:51-55) |
| `StorageFails`, `Crash` | a raw write or a commit that throws; a process that dies |

The sync commit is `05e45f5` on AntelopeJS/dms-marketing `feat/verify-dms-marketing-skill`, where the model was written and each finding replayed. The covered files last changed in `cdff457`.

## Bounds and what is left out

`Crash.ci` runs three calls over one day, `Stall.ci` two calls over one day, and both full configurations three calls over two days. A pass covers these bounds only. The model leaves out:

- calls with different import ids, which the claim refuses (claim.ts:130-131), and imports written before the ledger (`ledgered` unset);
- payloads that differ between calls: every call carries the same history, so a resumed payload with a day the first lacked is not checked;
- several visitors per day: one write stands for a day's visitors, and `IMPORT_CONCURRENCY` workers are not modeled;
- `discardUncommitted` is one step, while the code lists the rows and then deletes them;
- a renewal or a release that fails in storage: a failed renewal changes nothing, which `Stall` covers, and a release that fails leaves the claim behind as a death after release does;
- a `swapClaim` whose outcome is `unknown`, and the read-merge-write of `appliedImports`, where two commits of one day can keep one entry;
- liveness, and the chronology boundary of other imports.

`no-held-check` passes the CI configuration, because dropping the `isHeld()` check only adds paths to F3 and F4 there. The full configuration catches it: its 28-state `StoredOnce` path needs the check to stop the holder that lost the claim, and without the check the shortest path has 30 states.

## Confirm the check can fail

On a scratch copy of this folder with `node_modules` reachable (a symlink beside it), apply one model edit at a time and run `check.mjs` with and without `--full`. Each edit mirrors the code change in the first column. These ran at the sync commit.

| Scratch change in the code, and the model edit | CI configuration | Full configuration |
| --- | --- | --- |
| `held-without-insert`: `acquireClaim` returns `held(token)` without the insert (claim.ts:120): `InsertClaim` always holds, no row | `BROKEN CountedOnce`, `CHANGED OneWriter: 12 states (recorded 31)` | `BROKEN CountedOnce`, `CHANGED OneWriter: 12 states (recorded 34)` |
| `swap-without-token`: `swapClaim` is a plain `update` of the token (model.ts:47-60): `TakeOver` and `Renew` swap whatever token is stored | `BROKEN CountedOnce`, `CHANGED OneWriter: 23 states (recorded 31)` | `BROKEN CountedOnce`, `CHANGED OneWriter: 23 states (recorded 34)` |
| `resume-without-ledger`: a resume ignores the ledger (replay.ts:257-259): `ReadLedger` reads no day | `BROKEN CountedOnce` | same |
| `resume-without-discard`: a resume skips `discardUncommitted` (replay.ts:260-262): `Discard` keeps every row | `BROKEN StoredOnce` | same |
| `discard-counted-days`: `discardUncommitted` gets an empty set (replay.ts:261): `Discard` empties every day | `BROKEN NothingLost` | same |
| `no-held-check`: the `isHeld()` check goes (replay.ts:157-159): `Check` always writes | exit 0 | `CHANGED StoredOnce: 30 states (recorded 28)` |

Every scratch run in the table exited 1, except `no-held-check` on the CI configuration. With the edits dropped, both configurations exit 0.
