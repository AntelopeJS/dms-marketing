---
name: formal-import-claim
description: TLA+ model of the website claim of ImportAnalytics in @antelopejs/dms-marketing (the claim row `<websiteId>:`, its insert, the token renewal, the 30-poll watch and takeover, ownerFinished) and of the day-by-day replay it guards (the ledger read, the discard of uncounted days, the raw writes, the day commit), checked with TLC. Use when a change touches analytics-import-claim.ts, analytics-import.ts, analytics-import-replay.ts or rollup-write.ts under packages/dms-marketing/src/services, or db/models/marketing_imports.model.ts, or needs proof that concurrent ImportAnalytics calls keep one writer per website and replay a history once.
---

# Formal check: the ImportAnalytics claim and replay

`ImportAnalytics` claims a website by inserting the row `<websiteId>:` into `marketing_imports` with a random `claimToken`. The holder swaps the token every 5 s while it replays. A call that finds the row reads the holder's import row, watches the token for 30 polls of 1 s, and takes the claim over with `swapClaim` when the token never changed. A call that holds the claim and finds the import started resumes it: it deletes the raw rows of the days the ledger (`appliedImports` of the day rows) does not name, then replays those days. A day commits its counters and its ledger entry in one write. The import row carries a `fence`, and each write to it (set running on a resume, done, failed) is a compare-and-set on the fence the call last read or wrote; a call whose fence was replaced reads the row back and answers it. The docs promise one writer per website across instances and a history counted once, also when calls race, a holder stalls or dies, and a silent holder is taken over.

The model treats each database round trip as one step. TLC checks every order of those steps across concurrent calls with one import id, a storage failure, a process death, and a live holder that stops for 30 s and resumes, within the bounds below.

- `ImportClaim.tla` holds the variables and the actions, and `ImportClaimRules.tla` the rules; `check.mjs` runs the latter. Each condition carries a `file.ts:NN` comment. Under `packages/dms-marketing/src/`, `claim.ts` is `services/analytics-import-claim.ts`, `import.ts` is `services/analytics-import.ts`, `replay.ts` is `services/analytics-import-replay.ts`, `rollup.ts` is `services/rollup-write.ts` and `model.ts` is `db/models/marketing_imports.model.ts`.
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
| CI (`<config>.ci.cfg`) | 3 and 1, 2 and 1 | 5,056, 2,206 | 4.8 s |
| Full (`<config>.cfg`) | 3 and 2, 3 and 2 | 8,319, 3,925,924 | 46.2 s |

Every configuration allows one storage failure; `Crash` allows one process death. The times are one run each in Docker Java 21 on a shared 16-core server.

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
| `OneWriter` | At most one call is about to delete uncounted rows, store a day's rows or commit a day. | Two writers count a day twice or delete each other's rows. | holds | F3 (16, 16) |
| `CountedOnce` | A day's counters and ledger entry are committed at most once. | The Overview and Acquisition counts of the day are doubled, and no resume undoes it. | holds | F3 (22, 22) |
| `StoredOnce` | Once no call runs, a counted day's raw events and sessions come from one replay. | Funnels, heatmaps and hourly traffic, which read raw events, count the day twice for good. | holds | F3 (27, 27) |
| `NothingLost` | Once no call runs, an import that says done has every day counted and stored. | The rollup counts visits whose events and sessions are gone for good. | holds | F4 (holds, 38) |
| `DoneStaysDone` | A completed import stays done. | Its caller gets "failed part-way", and other import ids are refused until the id is called again. | holds | holds |
| `CallsAnswer` | A call that met no storage failure answers `imported`, `in_progress` or `skipped`. | The caller gets "failed part-way" for an import that is running or complete. | holds | holds |
| `LoserWritesNothing` | A call whose import-row insert failed only releases the claim and answers. | A loser that resumes runs a second replay beside the holder. | holds | holds |

`TypeOK` holds too. The numbers in brackets are the states of TLC's shortest counterexample, which `check.mjs` records per configuration. A liveness rule (every call returns) is out of reach of the shared runner.

## What stays unfenced

Only the import row is fenced. The raw writes, `discardUncommitted` and the day commit of a holder that stalled past the 30-poll watch still land after the takeover, and so does the discard of one that stalled between its `isHeld()` check and the deletes: `OneWriter`, `CountedOnce`, `StoredOnce` and the full configuration's `NothingLost` record those paths. Fencing them needs a write that applies only while the claim row holds the writer's token, across `marketing_events`, `marketing_sessions` and `website_statistics`: a multi-document transaction or a write conditioned on another row. `@antelopejs/interface-database` offers neither; its `atomicMutation` conditions one row on that row's own field. Checking `isHeld()` in the same step as each write does not close the gap either: with `Discard`, `WriteRaw`, `Commit` and `MarkDone` each guarded by `holds[c]`, both `Stall` configurations broke every one of these rules at its recorded length, since a holder that stalled has not renewed and still reads its claim as held.

## Findings at the sync commit

Each finding was replayed on `packages/dms-marketing/dist` built at the sync commit, inside `ajs module test` with the backend suite's DMS and MongoDB 8.0.8, one database call per model action in TLC's order (see Real bug or modeling error). The replay was a scratch test file and is not committed. The findings are not filed.

- **F1. ownerFinished deleted a live holder's claim (claim.ts:143-144), fixed.** A call that cannot insert the claim reads the holder's import row. When that row says done, it deletes the claim with the token it read, also while the holder sits between its done write (import.ts:427-433) and `claim.release()` (line 434). The holder's release then found no row, `releaseClaim` threw "Analytics import claim release was not confirmed" (model.ts:112-114), and its catch marked the complete import failed (import.ts:441-451). The replay of the 18-state path logged `after MarkFailed: {"importRow":"failed",...,"ledgerEntries":1}` and c1 `{"rejects":"... failed part-way; call it again to resume: Analytics import claim release was not confirmed"}`. When c2 reads the import row before c1 marks it failed, c2 answers `skipped` and the row ends `failed`. c1's rejection is the shortest `CallsAnswer` path under `Crash` (19 and 22 states). With three calls (31 and 34 states), the import row still says done after c2 inserted a new claim, so c3 deletes c2's live claim too, and both resume: the replay logged `waiting: c1 at release claim, c2 at discard, c3 at discard`. The ledger names every day by then, so no data rule breaks in these bounds. Now both releases that follow a done import row ignore their error (import.ts:401, 434): a claim on a done import guards nothing, so `ownerFinished` may delete it at any time. The backend tests "a holder whose claim goes after it records done answers imported" and "a call that finds the import done answers skipped when its claim goes before its release" replay the race: before, each holder rejected with "failed part-way; call it again to resume: Analytics import claim release was not confirmed", and with only line 434 fixed the second test's skipping call rejected with "Analytics import claim release was not confirmed"; after, they answer `imported` and `skipped` and the import row stays done. Every rule holds under `Crash` in both configurations, `CallsAnswer` holds under `Stall` too, and the `chart-crash` configuration reaches 474 states with no bug path.
- **F2. A racing call rethrew the insert's duplicate-key error (claim.ts:133-141), fixed.** The call's insert failed on the holder's row, the holder released, and the call's read found no row, so `if (!owner?.claimToken) throw failure` rejected with the insert error. The replay logged c2 `{"rejects":"Duplicate key on index \"_id\" (_id)"}` after the holder's storage failure (13 states) and after a holder that completed normally (`chart-crash`, 14 steps). Now a `DuplicateKeyError` with no row left inserts again, as a watcher does when the row goes (`ReadOwner` goes to `insert`), and any other insert error with no row still rethrows. The third such loss rethrows too: `_id` is unique across tenants while the owner read sees one tenant, so a claim row left under another tenant would otherwise fail the insert forever, and the test "a claim row the owner read cannot see rejects with the duplicate key after a bounded retry" holds it to three inserts. The backend test "a claim insert that loses to a holder released before the owner read inserts again" replays the race, with the fake model throwing `DuplicateKeyError` as the database does: it rejected with `DuplicateKeyError: Duplicate key on index "_id" (_id)` before and answers `imported` after. `CallsAnswer` now holds in every configuration. Under `Stall`, an import-row insert (import.ts:320) that loses to another holder's no longer rethrows: its catch reads the row back, releases and answers `in_progress`, or `skipped` for a done row (import.ts:322-326, 274-298, `ReadBack`, `ReleaseFound`). Replayed with the real `MarketingImportsModel` and the other models faked, a taker whose insert loses to the stalled holder's (`chart-stall`, 13 steps before) logged the duplicate key before and `{"answer":"in_progress"}` after, as did a stalled holder that loses after its renewal saw the takeover. One that loses before any renewal holds a token the claim row no longer has, so its `release()` throws "Analytics import claim release was not confirmed" (model.ts:112-114); the read-back retries the release once and then ignores its error (import.ts:281-284), so it answers `in_progress` too. The same replay on the 15-state path (c1 holds without renewing, c2 takes over and inserts the row, c1's read-back finds it running) logged c1 `{"rejects":"Analytics import claim release was not confirmed"}` before and `{"answer":"in_progress"}` after, with c2's claim row left in place. A ghost set when a call reaches the read-back's release, with the invariant that such a call answers `in_progress` or `skipped`, breaks on the earlier model in 15 states and holds under both `Stall` configurations.
- **F3. The replay's writes are not fenced by the claim (replay.ts:163-170, 288-293), import-row writes fixed.** `isHeld()` is read once before each visitor, and only the 5 s renewal clears it. A holder that stops after that read for 30 s is taken over, and when it resumes it stores the day's rows and commits the day. The commit appends a ledger entry even when the day row already names the import (rollup.ts:150-155). A holder with no day left marks the import done after its renewal found the claim gone, and a taker that read the import row running sets it running again, the shortest `DoneStaysDone` path under `Stall` (19 and 22 states). Replays: `CountedOnce` logged `after the second Commit: {"days":[{"pageviews":2,"sessions":2,"ledgerEntries":2}],"rawEvents":1}` for one pageview. `StoredOnce` (27) ended `{"importRow":"done","days":[{"pageviews":1,"sessions":0,"ledgerEntries":1}],"rawEvents":2}`. Its 28-state path, recorded before a holder that lost the claim stopped marking the import failed, ended with both calls failed and `"rawEvents":2`, and a later call resumed to `done` with day 1 still at two events. On the `chart-stall` path, c1 logged `Renew c1: swap claim -> undefined`, then committed, marked done and returned `{"answer":"imported"}`, and c2 committed the day again: `"pageviews":2,"ledgerEntries":2,"rawEvents":2`. Now the import row is fenced (import.ts:306-327, 427-433, 441-451, model.ts:72-101): a taker that read the row running before the stalled holder marked it done finds a fence it did not read, reads the row back and answers `skipped`, and a stalled holder whose taker set the row running answers that row instead of marking it done or failed. `DoneStaysDone` holds under `Stall` in both configurations. The backend test "a taker that read the import running answers skipped once the stalled holder marks it done" replays the 19-state path with the fake models: before, the taker answered `imported` after setting the done row running again; after, it answers `skipped` and the row stays done. "A stalled holder whose taker set the import running answers in_progress instead of marking it done" runs the other order. A fenced write whose outcome is `unknown` reads the row back, and throws while the row still carries the call's fence, so a write that failed in storage is not taken for a takeover. A row stored before the fence has no `fence` field, and its first fenced write matches the missing field, so its next call resumes it and installs a fence; the test "takes a row stored without a fence once, then only the fence it installed" runs that against MongoDB. The raw writes and the commit stay unfenced (see What stays unfenced).
- **F4. A holder that lost the claim still deletes rows (import.ts:397-425, replay.ts:268-274), fixed for a holder that knows it.** Nothing read `isHeld()` between the acquisition and the first visitor. A call whose renewal found another token still sets the import row running, reads the ledger and runs `discardUncommitted`, which deletes the rows its taker just stored. Its check then throws, and the taker commits the day and marks it done over the deleted rows. The replay (26 states) ended `{"importRow":"done","days":[{"pageviews":1,"sessions":1,"ledgerEntries":1}],"rawEvents":0,"rawSessions":0}`; the 29-state path the same with day 2 intact. Both paths are one state shorter now that the throw answers at once. The catch used to mark the import failed under the taker and reject with "failed part-way", the shortest `CallsAnswer` path under `Stall` (16 states): a new import's holder, taken over after it read the ledger, rejected while its taker replayed. Fixed: a catch that finds `isHeld()` false leaves the import row to the taker and answers `in_progress` (import.ts:437-440); `release()` has no token left to delete. The backend test "a holder whose renewal saw the takeover answers in_progress and leaves the taker's import running" holds a new import's holder after its row insert until the taker writes and the holder's renewal has seen the takeover. It rejected with "failed part-way; call it again to resume: another instance took the website claim over" before, and answers `in_progress` with the import row still running after. `isHeld()` turns false only at a renewal, so a holder that fails before its renewal has seen the takeover still marks the import failed under the taker; the model keeps that window, since `Renew` is its own step, and `CallsAnswer` still holds under `Stall` in both configurations. A resume now checks `isHeld()` before `discardUncommitted` and throws when it is false (replay.ts:272), so a holder whose renewal saw the takeover deletes nothing; `NothingLost` holds in the CI configuration. The backend test "the holder deletes none of the taker's raw rows" fails without that check. A holder that stalls after that check deletes anyway: the full configuration's 38-state path resumes c2 after c1 failed on day 2, stalls c2 before its discard while c3 takes over and stores day 2, and c2's discard then deletes c3's day 2 rows before c3 marks the import done.

`Stall` stands for any holder whose token stays unchanged for 30 s of the watcher's polls while it can still write afterwards: a paused process (a GC pause, a frozen VM or container, a debugger), or renewals that fail or hang (a failed swap is logged and the old token kept, and later renewals queue behind a hung one) while the replay's own writes go through.

## Read every result with /statechart

Read each TLC result with the pstack `/statechart` skill. Work on a copy of `ImportClaim.tla`, `ImportClaimRules.tla` (the spec to open), the map and the chart configs in a scratch folder outside the repo, since it writes its output next to its input. Use `ImportClaim.map.mjs` as the view: one region each for the claim row, the import row and the history, and one per call. `chart-crash.cfg` (two calls, one day, one death, no storage failure) reaches 474 states, and every rule holds there since F1's fix. `chart-stall.cfg` (two calls, one day, stalls, no storage failure) reached 1,884 states and drew four bug paths before the import row was fenced: `OneWriter` in 15 steps, `CountedOnce` in 21, `NothingLost` in 24 and `StoredOnce` in 27; rerun it to see which the fence removed. Read the report's numbered paths before the chart. The view hides `Settled`, the step that changes nothing once nothing else can happen. A new bug shows as a new numbered path, and a fix shows which paths it removes.

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
| `Begin` | the import row read, `skipped` for a done import (import.ts:356-359, 196-220) |
| `InsertClaim` | the plain insert of the claim row (claim.ts:128-129) |
| `ReadOwner`, `OwnerFinished`, `ReleaseOwner` | the owner read, the insert again when no row is left, the rethrow, `ownerFinished` and its release (claim.ts:133-148, 88-94, model.ts:103-115) |
| `Poll`, `GiveUp`, `TakeOver` | `watchClaim` (claim.ts:71-82) and the takeover swap (lines 148-152, model.ts:55-70), `in_progress` (import.ts:387-389) |
| `Renew` | `holdClaim`'s interval: swap, then a read that clears the token (claim.ts:31-57) |
| `ReadCurrent`, `WriteRow`, `ReadBack`, `ReleaseSkip`, `ReleaseFound`, `ReleaseErr` | the import row read, the fenced resume or the insert, the read-back, and the first catch (import.ts:397-416, 274-327, model.ts:72-101) |
| `ReadLedger`, `Discard` | `readLedger`, the `isHeld()` check and `discardUncommitted` (replay.ts:268-274, 200-254) |
| `Check`, `WriteRaw`, `Commit` | the per-visitor `isHeld()` check and replay (replay.ts:161-177, 187-192), the day commit (lines 279-294, rollup.ts:121-157, 183-193) |
| `MarkDone`, `Release`, `MarkFailed`, `ReleaseFailed` | the fenced done write, release, and the second catch (import.ts:418-457), `release()` (claim.ts:58-62) |
| `StorageFails`, `Crash` | a raw write or a commit that throws; a process that dies |

The sync commit is `05e45f5` on AntelopeJS/dms-marketing `feat/verify-dms-marketing-skill`, where the model was written and each finding replayed. The covered files last changed when the import row got its fence.

## Bounds and what is left out

`Crash.ci` runs three calls over one day, `Stall.ci` two calls over one day, and both full configurations three calls over two days. A pass covers these bounds only. The model leaves out:

- calls with different import ids, which the claim refuses (claim.ts:145-146), and imports written before the ledger (`ledgered` unset);
- payloads that differ between calls: every call carries the same history, so a resumed payload with a day the first lacked is not checked;
- several visitors per day: one write stands for a day's visitors, and `IMPORT_CONCURRENCY` workers are not modeled;
- `discardUncommitted` is one step, while the code lists the rows and then deletes them;
- a claim insert that fails other than on a duplicate key, which rethrows, and the bound of three claim inserts lost to a released row: each loss needs another call to create the claim row and remove it, and a call creates it at most once, so with three calls a call loses at most twice;
- a renewal or a release that fails in storage: a failed renewal changes nothing, which `Stall` covers, and a release that fails leaves the claim behind as a death after release does;
- a `swapClaim` whose outcome is `unknown`, and the read-merge-write of `appliedImports`, where two commits of one day can keep one entry;
- liveness, and the chronology boundary of other imports.

`no-held-check` only lengthens paths of F3 and F4, which need the check to stop the holder that lost the claim: under `Stall`, `NothingLost` takes 26 states instead of 25 in the CI configuration, and `StoredOnce` 30 instead of 27 in the full one.

## Confirm the check can fail

On a scratch copy of this folder with `node_modules` reachable (a symlink beside it), apply one model edit at a time and run `check.mjs` with and without `--full`. Each edit mirrors the code change in the first column. These ran at the sync commit.

| Scratch change in the code, and the model edit | CI configuration | Full configuration |
| --- | --- | --- |
| `held-without-insert`: `acquireClaim` returns `held(token)` without the insert (claim.ts:128): `InsertClaim` always holds, no row | `BROKEN CountedOnce`, `CHANGED OneWriter: 12 states (recorded 31)` | `BROKEN CountedOnce`, `CHANGED OneWriter: 12 states (recorded 34)` |
| `swap-without-token`: `swapClaim` is a plain `update` of the token (model.ts:56-69): `TakeOver` and `Renew` swap whatever token is stored | `BROKEN CountedOnce`, `CHANGED OneWriter: 23 states (recorded 31)` | `BROKEN CountedOnce`, `CHANGED OneWriter: 23 states (recorded 34)` |
| `resume-without-ledger`: a resume ignores the ledger (replay.ts:268-270): `ReadLedger` reads no day | `BROKEN CountedOnce` | same |
| `resume-without-discard`: a resume skips `discardUncommitted` (replay.ts:271-274): `Discard` keeps every row | `BROKEN StoredOnce` | same |
| `discard-counted-days`: `discardUncommitted` gets an empty set (replay.ts:273): `Discard` empties every day | `BROKEN NothingLost` | same |
| `no-held-check`: the `isHeld()` check goes (replay.ts:163): `Check` always writes | `CHANGED NothingLost: 26 states (recorded 25)` | `CHANGED StoredOnce: 30 states (recorded 27)`, `CHANGED NothingLost: 29 states (recorded 28)` |
| `readback-continues`: the read-back resumes the row instead of answering (import.ts:322-326, 274-298): `ReadBack` goes to `ledger` as a resume | `BROKEN LoserWritesNothing` (14 states, under `Stall`) | same |

These ran before the import row was fenced, and the `NothingLost` rows before a resume checked `isHeld()` ahead of its discard. Every scratch run in the table exited 1. The `CHANGED OneWriter` outputs compare with the `Crash` records F1's fix removed; with no record left, the runner reports that rule as `BROKEN`. `no-held-check` ran again once a holder that lost the claim answered `in_progress` instead of marking the import failed. With the edits dropped, both configurations exit 0.

Only `LoserWritesNothing` catches `readback-continues`: F3 already reaches the states it adds. The rows above it ran before that rule existed.
