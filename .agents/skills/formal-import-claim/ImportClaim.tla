------------------------------ MODULE ImportClaim ------------------------------
(***************************************************************************)
(* The website claim of ImportAnalytics in @antelopejs/dms-marketing, and *)
(* the replay it guards. File names are under packages/dms-marketing/src/:*)
(* claim.ts is services/analytics-import-claim.ts, import.ts is           *)
(* services/analytics-import.ts, replay.ts is                             *)
(* services/analytics-import-replay.ts, rollup.ts is                      *)
(* services/rollup-write.ts and model.ts is                               *)
(* db/models/marketing_imports.model.ts.                                  *)
(*                                                                         *)
(* Every call carries the same import id for the same website. A call    *)
(* inserts the claim row `websiteId:` to hold the website, or watches the *)
(* holder's token and takes the claim over once the token stays           *)
(* unchanged (claim.ts:106-155). The holder replaces its token every 5 s  *)
(* (claim.ts:33-66) and replays the history one UTC day at a time         *)
(* (replay.ts:271-311).                                                   *)
(*                                                                         *)
(* One database round trip is one step, and Node runs other calls at     *)
(* every await, so steps of different calls interleave in any order. A    *)
(* token is unique (randomUUID), so the model records whose token the     *)
(* claim row holds and whether it changed since a watcher read it, not    *)
(* the token itself. When Stalls is FALSE, a holder either renews within  *)
(* the 30 s a watcher waits or has died; when it is TRUE, a holder may    *)
(* stop for 30 s and then resume.                                         *)
(*                                                                         *)
(* The funnel trails index the funnel events of `marketing_events` per   *)
(* session (db/models/funnel_trails.model.ts). A replay's raw write adds  *)
(* its events to them, and a backfill walk adds the events it reads, under *)
(* a generation that `discardUncommitted` moves before and after it deletes*)
(* events (services/funnels/trail-backfill.ts). These steps change only   *)
(* the trail variables, so the rules on the other variables keep their    *)
(* paths.                                                                  *)
(***************************************************************************)
EXTENDS Integers, FiniteSets, TLC

CONSTANTS
  Calls,        \* ImportAnalytics calls with one import id, on any instances
  Days,         \* UTC days of the history, 1..Days, each with events
  MaxFailures,  \* storage writes that fail in one behaviour
  MaxCrashes,   \* calls whose process dies in one behaviour
  Stalls,       \* whether a holder can stop for 30 s and resume
  Walks,        \* backfill walks of the website in one behaviour
  TrailsTracked \* whether the trail steps run at all

None == "none"
DaySet == 1..Days

VARIABLES
  claim,     \* whose token the claim row `websiteId:` holds, or None: no row
  row,       \* status of the import row `websiteId:importId`, or "none"
  ledger,    \* per day, the commits of the import's counters and ledger entry
  raw,       \* per day, the calls whose raw events and sessions are stored
  everDone,  \* the import row has said "done"
  pc,        \* where each call is
  holds,     \* holdClaim's `token` is set (claim.ts:38, 59)
  seen,      \* the holder of the claim the call read as `owner` (claim.ts:135)
  moved,     \* the claim's token changed since the call read `owner`
  resuming,  \* `current !== undefined` (import.ts:405)
  counted,   \* the days the ledger named when the call read it (replay.ts:284)
  day,       \* the day the call replays next
  answer,    \* what the call returned, or "error" when it rejected
  failed,    \* the call met a storage failure
  failures,
  crashes,
  lost,      \* its import-row insert or fenced resume failed
  fence,     \* the import row's fence: the count of fenced writes
  fenceOf,   \* the fence the call last read or wrote
  trail,     \* per day, the calls whose raw rows the funnel trails hold
  gen,       \* the website's backfill generation
  listed,    \* per call, per day, the raw rows its discard listed
  tail,      \* per call, the discard's steps left after its deletes
  walks,     \* backfill walks begun
  wpc,       \* where the backfill walk is
  wgen,      \* the generation the walk began in
  wread,     \* per day, the raw rows the walk read
  wrote      \* per day, the trail entries the walk's flush added

trailVars == <<trail, gen, listed, tail, walks, wpc, wgen, wread, wrote>>

vars == <<claim, row, ledger, raw, everDone, pc, holds, seen, moved, resuming,
          counted, day, answer, failed, failures, crashes, lost, fence,
          fenceOf, trail, gen, listed, tail, walks, wpc, wgen, wread, wrote>>

PCs == {"idle", "insert", "readOwner", "ownerFinished", "releaseOwner", "watch",
        "takeover", "current", "releaseSkip", "writeRow", "readBack",
        "releaseFound", "releaseErr", "ledger", "discard", "check", "write",
        "commit", "markDone", "release", "markFailed", "releaseFailed", "end",
        "crashed"}

(* From acquiring the claim until release() clears the interval.          *)
Holding == {"current", "releaseSkip", "writeRow", "readBack", "releaseFound",
            "releaseErr", "ledger", "discard", "check", "write", "commit",
            "markDone", "release", "markFailed", "releaseFailed"}

Answers == {"none", "imported", "in_progress", "skipped", "error"}

Init ==
  /\ claim = None
  /\ row = "none"
  /\ ledger = [d \in DaySet |-> 0]
  /\ raw = [d \in DaySet |-> {}]
  /\ everDone = FALSE
  /\ pc = [c \in Calls |-> "idle"]
  /\ holds = [c \in Calls |-> FALSE]
  /\ seen = [c \in Calls |-> None]
  /\ moved = [c \in Calls |-> FALSE]
  /\ resuming = [c \in Calls |-> FALSE]
  /\ counted = [c \in Calls |-> {}]
  /\ day = [c \in Calls |-> 1]
  /\ answer = [c \in Calls |-> "none"]
  /\ failed = [c \in Calls |-> FALSE]
  /\ failures = 0
  /\ crashes = 0
  /\ lost = [c \in Calls |-> FALSE]
  /\ fence = 0
  /\ fenceOf = [c \in Calls |-> 0]
  /\ trail = [d \in DaySet |-> {}]
  /\ gen = 0
  /\ listed = [c \in Calls |-> [d \in DaySet |-> {}]]
  /\ tail = [c \in Calls |-> "none"]
  /\ walks = 0
  /\ wpc = "idle"
  /\ wgen = 0
  /\ wread = [d \in DaySet |-> {}]
  /\ wrote = [d \in DaySet |-> {}]

TypeOK ==
  /\ claim \in Calls \cup {None}
  /\ row \in {"none", "running", "done", "failed"}
  /\ fence \in Nat
  /\ \A d \in DaySet : ledger[d] \in Nat /\ raw[d] \subseteq Calls
  /\ \A c \in Calls :
       /\ pc[c] \in PCs
       /\ seen[c] \in Calls \cup {None}
       /\ counted[c] \subseteq DaySet
       /\ day[c] \in 1..(Days + 1)
       /\ answer[c] \in Answers
       /\ lost[c] \in BOOLEAN
       /\ fenceOf[c] \in Nat
       /\ tail[c] \in {"none", "fence", "forget"}
       /\ \A d \in DaySet : listed[c][d] \subseteq Calls
  /\ gen \in Nat
  /\ walks \in 0..Walks
  /\ wpc \in {"idle", "read", "flush", "write", "check", "forget"}
  /\ \A d \in DaySet :
       trail[d] \cup wread[d] \cup wrote[d] \subseteq Calls

(* The first day from `from` on that the ledger read did not name.       *)
NextDay(from, named) ==
  LET left == {d \in from..Days : d \notin named}
  IN IF left = {} THEN Days + 1 ELSE CHOOSE d \in left : \A e \in left : d <= e

(* The claim row got a new token, or appeared or went: every earlier read *)
(* of `owner` is now stale.                                               *)
Touch == moved' = [w \in Calls |-> TRUE]

Go(c, to) == pc' = [pc EXCEPT ![c] = to]

Finish(c, result) ==
  /\ pc' = [pc EXCEPT ![c] = "end"]
  /\ answer' = [answer EXCEPT ![c] = result]

(* release(): stops renewing, then deletes the claim row only while it    *)
(* still holds this call's token, and throws when the delete is not       *)
(* confirmed (claim.ts:60-64, model.ts:103-115). Every caller ignores that *)
(* error or rejects anyway, so the model leaves it out.                   *)
ReleaseApplies(c) ==
  IF holds[c] /\ claim = c
  THEN claim' = None /\ Touch
  ELSE UNCHANGED <<claim, moved>>

Frozen == /\ UNCHANGED <<row, ledger, raw, everDone, resuming, counted, day,
                         failed, failures, crashes, lost, fence, fenceOf>>
          /\ UNCHANGED trailVars

(* A fenced write applies while the row still carries the fence    *)
(* the call last read or wrote, and installs a fresh one (model.ts:72-101).*)
Fenced(c) == fence = fenceOf[c]

NewFence(c) ==
  /\ fence' = fence + 1
  /\ fenceOf' = [fenceOf EXCEPT ![c] = fence + 1]

(* ------------------------------ acquiring ------------------------------ *)

(* `applied = get(rowId)`: a done import answers "skipped" before it      *)
(* touches the claim (import.ts:362-365, 202-221). A running or failed    *)
(* one is resumable, since every row here is ledgered (import.ts:197-200).*)
Begin(c) ==
  /\ pc[c] = "idle"
  /\ IF row = "done"
     THEN Finish(c, "skipped")
     ELSE Go(c, "insert") /\ UNCHANGED answer
  /\ UNCHANGED <<claim, holds, seen, moved>>
  /\ Frozen

(* The plain insert of the claim row elects the writer (claim.ts:130-131).*)
InsertClaim(c) ==
  /\ pc[c] = "insert"
  /\ IF claim = None
     THEN /\ claim' = c /\ Touch
          /\ holds' = [holds EXCEPT ![c] = TRUE]
          /\ Go(c, "current")
     ELSE /\ Go(c, "readOwner")
          /\ UNCHANGED <<claim, moved, holds>>
  /\ UNCHANGED <<seen, answer>>
  /\ Frozen

(* `owner = get(claimRow._id)`; no row means the holder whose row the     *)
(* insert hit has released it since, so the call inserts again            *)
(* (claim.ts:135-140). The third such loss answers `unseen`, refused by   *)
(* importAnalytics (import.ts:396-397); each loss needs another call's    *)
(* claim to come and go, so a call with two others never gets there.      *)
ReadOwner(c) ==
  /\ pc[c] = "readOwner"
  /\ IF claim = None
     THEN Go(c, "insert") /\ UNCHANGED <<seen, moved>>
     ELSE /\ seen' = [seen EXCEPT ![c] = claim]
          /\ moved' = [moved EXCEPT ![c] = FALSE]
          /\ Go(c, "ownerFinished")
  /\ UNCHANGED <<claim, holds, answer>>
  /\ Frozen

(* ownerFinished reads the import row: a done import's holder stopped     *)
(* before releasing (claim.ts:142, 90-96). Otherwise the owner holds this *)
(* same ledgered import, so the call watches it (claim.ts:144-147).      *)
OwnerFinished(c) ==
  /\ pc[c] = "ownerFinished"
  /\ Go(c, IF row = "done" THEN "releaseOwner" ELSE "watch")
  /\ UNCHANGED <<claim, holds, seen, moved, answer>>
  /\ Frozen

(* releaseClaim(owner token), errors ignored, then insert again           *)
(* (claim.ts:143, model.ts:103-115).                                       *)
ReleaseOwner(c) ==
  /\ pc[c] = "releaseOwner"
  /\ IF claim # None /\ ~moved[c]
     THEN claim' = None /\ Touch
     ELSE UNCHANGED <<claim, moved>>
  /\ Go(c, "insert")
  /\ UNCHANGED <<holds, seen, answer>>
  /\ Frozen

(* One poll of watchClaim: the row is gone, so insert again; its token    *)
(* changed, so the owner is alive and the call answers "in_progress"      *)
(* (claim.ts:79-81, 148, import.ts:393-395).                              *)
Poll(c) ==
  /\ pc[c] = "watch"
  /\ \/ /\ claim = None
        /\ Go(c, "insert") /\ UNCHANGED answer
     \/ /\ claim # None /\ moved[c]
        /\ Finish(c, "in_progress")
  /\ UNCHANGED <<claim, holds, seen, moved>>
  /\ Frozen

(* After 30 polls with the token unchanged the watcher judges the holder  *)
(* stopped (claim.ts:77-83). A live holder renews every 5 s, so without   *)
(* stalls that happens only once the holder's process died.               *)
GiveUp(c) ==
  /\ pc[c] = "watch"
  /\ claim # None /\ ~moved[c]
  /\ Stalls \/ pc[seen[c]] = "crashed"
  /\ Go(c, "takeover")
  /\ UNCHANGED <<claim, holds, seen, moved, answer>>
  /\ Frozen

(* swapClaim(owner token): taken, it holds; lost, the owner is alive      *)
(* (claim.ts:150-151, model.ts:55-70).                                    *)
TakeOver(c) ==
  /\ pc[c] = "takeover"
  /\ IF claim # None /\ ~moved[c]
     THEN /\ claim' = c /\ Touch
          /\ holds' = [holds EXCEPT ![c] = TRUE]
          /\ Go(c, "current") /\ UNCHANGED answer
     ELSE /\ Finish(c, "in_progress")
          /\ UNCHANGED <<claim, moved, holds>>
  /\ UNCHANGED seen
  /\ Frozen

(* ------------------------------ holding -------------------------------- *)

(* The renewal: swapClaim(token) replaces the holder's own token; failed, *)
(* a read finds another token and clears `token`, so isHeld() turns false *)
(* (claim.ts:40-57).                                                      *)
Renew(c) ==
  /\ pc[c] \in Holding /\ holds[c]
  /\ IF claim = c
     THEN Touch /\ UNCHANGED holds
     ELSE holds' = [holds EXCEPT ![c] = FALSE] /\ UNCHANGED moved
  /\ UNCHANGED <<claim, pc, seen, answer>>
  /\ Frozen

(* `current = get(rowId)`: done, release and answer "skipped"; otherwise  *)
(* resume from its fence when the row exists (import.ts:404-409).         *)
ReadCurrent(c) ==
  /\ pc[c] = "current"
  /\ IF row = "done"
     THEN Go(c, "releaseSkip") /\ UNCHANGED resuming
     ELSE /\ resuming' = [resuming EXCEPT ![c] = row # "none"]
          /\ Go(c, "writeRow")
  /\ fenceOf' = [fenceOf EXCEPT ![c] = fence]
  /\ UNCHANGED <<claim, row, ledger, raw, everDone, holds, seen, moved,
                 counted, day, answer, failed, failures, crashes, lost, fence>>
  /\ UNCHANGED trailVars

(* The release's error is ignored: another call's ownerFinished may have *)
(* deleted the claim of this done import (import.ts:407).                 *)
ReleaseSkip(c) ==
  /\ pc[c] = "releaseSkip"
  /\ ReleaseApplies(c)
  /\ Finish(c, "skipped")
  /\ UNCHANGED <<holds, seen>>
  /\ Frozen

(* A resume sets the row running while it carries the fence read; a new *)
(* one inserts it, failing on an existing row (import.ts:417, 312-333).   *)
WriteRow(c) ==
  /\ pc[c] = "writeRow"
  /\ LET wins == IF resuming[c] THEN Fenced(c) ELSE row = "none"
     IN /\ IF wins
           THEN row' = "running" /\ NewFence(c) /\ Go(c, "ledger")
           ELSE UNCHANGED <<row, fence, fenceOf>> /\ Go(c, "readBack")
        /\ lost' = [lost EXCEPT ![c] = ~wins]
  /\ UNCHANGED <<claim, ledger, raw, everDone, holds, seen, moved, resuming,
                 counted, day, answer, failed, failures, crashes>>
  /\ UNCHANGED trailVars

(* A call whose row insert or fenced write lost reads the row back: none *)
(* throws; a found row answers "skipped" when done, else "in_progress"    *)
(* since it is ledgered (import.ts:280-304, 202-221).                     *)
ReadBack(c) ==
  /\ pc[c] = "readBack"
  /\ IF row = "none"
     THEN Go(c, "releaseErr") /\ UNCHANGED answer
     ELSE /\ Go(c, "releaseFound")
          /\ answer' = [answer EXCEPT ![c] =
                           IF row = "done" THEN "skipped" ELSE "in_progress"]
  /\ UNCHANGED <<claim, holds, seen, moved>>
  /\ Frozen

(* The release is tried twice and its error ignored, also when another    *)
(* call took the claim over before this one renewed; the call returns     *)
(* what it read back (import.ts:287-291).                                 *)
ReleaseFound(c) ==
  /\ pc[c] = "releaseFound"
  /\ ReleaseApplies(c)
  /\ Go(c, "end")
  /\ UNCHANGED <<holds, seen, answer>>
  /\ Frozen

(* The catch releases, then throws (import.ts:419-424).                  *)
ReleaseErr(c) ==
  /\ pc[c] = "releaseErr"
  /\ ReleaseApplies(c)
  /\ Finish(c, "error")
  /\ UNCHANGED <<holds, seen>>
  /\ Frozen

=============================================================================
