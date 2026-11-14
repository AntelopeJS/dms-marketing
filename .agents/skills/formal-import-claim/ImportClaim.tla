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
(* unchanged (claim.ts:98-143). The holder replaces its token every 5 s   *)
(* (claim.ts:25-58) and replays the history one UTC day at a time         *)
(* (replay.ts:250-284).                                                   *)
(*                                                                         *)
(* One database round trip is one step, and Node runs other calls at     *)
(* every await, so steps of different calls interleave in any order. A    *)
(* token is unique (randomUUID), so the model records whose token the     *)
(* claim row holds and whether it changed since a watcher read it, not    *)
(* the token itself. When Stalls is FALSE, a holder either renews within  *)
(* the 30 s a watcher waits or has died; when it is TRUE, a holder may    *)
(* stop for 30 s and then resume.                                         *)
(***************************************************************************)
EXTENDS Integers, FiniteSets, TLC

CONSTANTS
  Calls,        \* ImportAnalytics calls with one import id, on any instances
  Days,         \* UTC days of the history, 1..Days, each with events
  MaxFailures,  \* storage writes that fail in one behaviour
  MaxCrashes,   \* calls whose process dies in one behaviour
  Stalls        \* whether a holder can stop for 30 s and resume

None == "none"
DaySet == 1..Days

VARIABLES
  claim,     \* whose token the claim row `websiteId:` holds, or None: no row
  row,       \* status of the import row `websiteId:importId`, or "none"
  ledger,    \* per day, the commits of the import's counters and ledger entry
  raw,       \* per day, the calls whose raw events and sessions are stored
  everDone,  \* the import row has said "done"
  pc,        \* where each call is
  holds,     \* holdClaim's `token` is set (claim.ts:30, 51)
  seen,      \* the holder of the claim the call read as `owner` (claim.ts:126)
  moved,     \* the claim's token changed since the call read `owner`
  resuming,  \* `current !== undefined` (import.ts:322)
  counted,   \* the days the ledger named when the call read it (replay.ts:257)
  day,       \* the day the call replays next
  answer,    \* what the call returned, or "error" when it rejected
  failed,    \* the call met a storage failure
  failures,
  crashes

vars == <<claim, row, ledger, raw, everDone, pc, holds, seen, moved, resuming,
          counted, day, answer, failed, failures, crashes>>

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

TypeOK ==
  /\ claim \in Calls \cup {None}
  /\ row \in {"none", "running", "done", "failed"}
  /\ \A d \in DaySet : ledger[d] \in Nat /\ raw[d] \subseteq Calls
  /\ \A c \in Calls :
       /\ pc[c] \in PCs
       /\ seen[c] \in Calls \cup {None}
       /\ counted[c] \subseteq DaySet
       /\ day[c] \in 1..(Days + 1)
       /\ answer[c] \in Answers

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
(* confirmed (claim.ts:52-56, model.ts:64-75).                            *)
ReleaseThrows(c) == holds[c] /\ claim # c
ReleaseApplies(c) ==
  IF holds[c] /\ claim = c
  THEN claim' = None /\ Touch
  ELSE UNCHANGED <<claim, moved>>

Frozen == UNCHANGED <<row, ledger, raw, everDone, resuming, counted, day,
                      failed, failures, crashes>>

(* ------------------------------ acquiring ------------------------------ *)

(* `applied = get(rowId)`: a done import answers "skipped" before it      *)
(* touches the claim (import.ts:277-280, 196-215). A running or failed    *)
(* one is resumable, since every row here is ledgered (import.ts:191-194).*)
Begin(c) ==
  /\ pc[c] = "idle"
  /\ IF row = "done"
     THEN Finish(c, "skipped")
     ELSE Go(c, "insert") /\ UNCHANGED answer
  /\ UNCHANGED <<claim, holds, seen, moved>>
  /\ Frozen

(* The plain insert of the claim row elects the writer (claim.ts:121-122).*)
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
(* (claim.ts:126-128).                                                    *)
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
(* before releasing (claim.ts:130, 82-88). Otherwise the owner holds this *)
(* same ledgered import, so the call watches it (claim.ts:132-135).      *)
OwnerFinished(c) ==
  /\ pc[c] = "ownerFinished"
  /\ Go(c, IF row = "done" THEN "releaseOwner" ELSE "watch")
  /\ UNCHANGED <<claim, holds, seen, moved, answer>>
  /\ Frozen

(* releaseClaim(owner token), errors ignored, then insert again           *)
(* (claim.ts:131, model.ts:64-75).                                        *)
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
(* (claim.ts:71-73, 136, import.ts:307-310).                              *)
Poll(c) ==
  /\ pc[c] = "watch"
  /\ \/ /\ claim = None
        /\ Go(c, "insert") /\ UNCHANGED answer
     \/ /\ claim # None /\ moved[c]
        /\ Finish(c, "in_progress")
  /\ UNCHANGED <<claim, holds, seen, moved>>
  /\ Frozen

(* After 30 polls with the token unchanged the watcher judges the holder  *)
(* stopped (claim.ts:69-75). A live holder renews every 5 s, so without   *)
(* stalls that happens only once the holder's process died.               *)
GiveUp(c) ==
  /\ pc[c] = "watch"
  /\ claim # None /\ ~moved[c]
  /\ Stalls \/ pc[seen[c]] = "crashed"
  /\ Go(c, "takeover")
  /\ UNCHANGED <<claim, holds, seen, moved, answer>>
  /\ Frozen

(* swapClaim(owner token): taken, it holds; lost, the owner is alive      *)
(* (claim.ts:138-139, model.ts:46-61).                                    *)
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
(* (claim.ts:32-49).                                                      *)
Renew(c) ==
  /\ pc[c] \in Holding /\ holds[c]
  /\ IF claim = c
     THEN Touch /\ UNCHANGED holds
     ELSE holds' = [holds EXCEPT ![c] = FALSE] /\ UNCHANGED moved
  /\ UNCHANGED <<claim, pc, seen, answer>>
  /\ Frozen

(* `current = get(rowId)`: done, release and answer "skipped"; otherwise  *)
(* resume when the row exists (import.ts:321-326).                        *)
ReadCurrent(c) ==
  /\ pc[c] = "current"
  /\ IF row = "done"
     THEN Go(c, "releaseSkip") /\ UNCHANGED resuming
     ELSE /\ resuming' = [resuming EXCEPT ![c] = row # "none"]
          /\ Go(c, "writeRow")
  /\ UNCHANGED <<claim, row, ledger, raw, everDone, holds, seen, moved,
                 counted, day, answer, failed, failures, crashes>>

(* A release that throws reaches the catch, which releases again and      *)
(* rethrows (import.ts:324, 349-351).                                     *)
ReleaseSkip(c) ==
  /\ pc[c] = "releaseSkip"
  /\ ReleaseApplies(c)
  /\ Finish(c, IF ReleaseThrows(c) THEN "error" ELSE "skipped")
  /\ UNCHANGED <<holds, seen>>
  /\ Frozen

(* A resumed import is set running again; a new one inserts its row,     *)
(* which fails when the row exists (import.ts:334-338).                   *)
WriteRow(c) ==
  /\ pc[c] = "writeRow"
  /\ IF resuming[c] \/ row = "none"
     THEN row' = "running" /\ Go(c, "ledger")
     ELSE UNCHANGED row /\ Go(c, "readBack")
  /\ UNCHANGED <<claim, ledger, raw, everDone, holds, seen, moved, resuming,
                 counted, day, answer, failed, failures, crashes>>

(* The insert's catch reads the row back: none rethrows the insert's     *)
(* error; a found row is answered as read, "skipped" when done and        *)
(* "in_progress" when running or failed, resumable since it is ledgered   *)
(* (import.ts:339-346, 203-215).                                          *)
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
(* what it read back (import.ts:342-346).                                 *)
ReleaseFound(c) ==
  /\ pc[c] = "releaseFound"
  /\ ReleaseApplies(c)
  /\ Go(c, "end")
  /\ UNCHANGED <<holds, seen, answer>>
  /\ Frozen

(* The catch releases and rethrows (import.ts:349-351).                   *)
ReleaseErr(c) ==
  /\ pc[c] = "releaseErr"
  /\ ReleaseApplies(c)
  /\ Finish(c, "error")
  /\ UNCHANGED <<holds, seen>>
  /\ Frozen

(* ------------------------------ replaying ------------------------------ *)

(* A resumed replay reads which days the ledger names (replay.ts:257-259, *)
(* 227-243); a new one starts from the first day.                         *)
ReadLedger(c) ==
  /\ pc[c] = "ledger"
  /\ IF resuming[c]
     THEN /\ counted' = [counted EXCEPT ![c] = {d \in DaySet : ledger[d] > 0}]
          /\ Go(c, "discard") /\ UNCHANGED day
     ELSE /\ day' = [day EXCEPT ![c] = 1]
          /\ Go(c, "check") /\ UNCHANGED counted
  /\ UNCHANGED <<claim, row, ledger, raw, everDone, holds, seen, moved,
                 resuming, answer, failed, failures, crashes>>

(* discardUncommitted deletes the import's raw rows on every day that    *)
(* ledger read did not name (replay.ts:260-262, 196-224).                 *)
Discard(c) ==
  /\ pc[c] = "discard"
  /\ raw' = [d \in DaySet |-> IF d \in counted[c] THEN raw[d] ELSE {}]
  /\ day' = [day EXCEPT ![c] = NextDay(1, counted[c])]
  /\ Go(c, "check")
  /\ UNCHANGED <<claim, row, ledger, everDone, holds, seen, moved, resuming,
                 counted, answer, failed, failures, crashes>>

(* A worker checks isHeld() before each visitor and throws once it is     *)
(* false (replay.ts:157-159). With no day left, the replay returns.       *)
Check(c) ==
  /\ pc[c] = "check"
  /\ Go(c, IF day[c] > Days THEN "markDone"
           ELSE IF holds[c] THEN "write" ELSE "markFailed")
  /\ UNCHANGED <<claim, holds, seen, moved, answer>>
  /\ Frozen

(* replayVisitor writes the day's raw events and sessions through        *)
(* ingestPreparedBatch and holds the rollup in memory (replay.ts:161-166).*)
WriteRaw(c) ==
  /\ pc[c] = "write"
  /\ raw' = [raw EXCEPT ![day[c]] = @ \cup {c}]
  /\ Go(c, "commit")
  /\ UNCHANGED <<claim, row, ledger, everDone, holds, seen, moved, resuming,
                 counted, day, answer, failed, failures, crashes>>

(* commitImportedDay adds the day's counters and its ledger entry in one  *)
(* write to the day row, with no look at the claim (replay.ts:276-281,    *)
(* rollup.ts:121-157, 183-193). Then the next day the ledger read did not *)
(* name.                                                                  *)
Commit(c) ==
  /\ pc[c] = "commit"
  /\ ledger' = [ledger EXCEPT ![day[c]] = @ + 1]
  /\ day' = [day EXCEPT ![c] = NextDay(day[c] + 1, counted[c])]
  /\ Go(c, "check")
  /\ UNCHANGED <<claim, row, raw, everDone, holds, seen, moved, resuming,
                 counted, answer, failed, failures, crashes>>

(* A raw write or a day commit fails in storage, and replayAll throws.    *)
StorageFails(c) ==
  /\ pc[c] \in {"write", "commit"}
  /\ failures < MaxFailures
  /\ failures' = failures + 1
  /\ failed' = [failed EXCEPT ![c] = TRUE]
  /\ Go(c, "markFailed")
  /\ UNCHANGED <<claim, row, ledger, raw, everDone, holds, seen, moved,
                 resuming, counted, day, answer, crashes>>

(* The import row is set done (import.ts:363-368).                        *)
MarkDone(c) ==
  /\ pc[c] = "markDone"
  /\ row' = "done" /\ everDone' = TRUE
  /\ Go(c, "release")
  /\ UNCHANGED <<claim, ledger, raw, holds, seen, moved, resuming, counted,
                 day, answer, failed, failures, crashes>>

(* release(), then "imported"; a release that throws lands in the catch   *)
(* (import.ts:369-370).                                                   *)
Release(c) ==
  /\ pc[c] = "release"
  /\ ReleaseApplies(c)
  /\ IF ReleaseThrows(c)
     THEN Go(c, "markFailed") /\ UNCHANGED answer
     ELSE Finish(c, "imported")
  /\ UNCHANGED <<holds, seen>>
  /\ Frozen

(* The catch sets the import row failed (import.ts:372-374).              *)
MarkFailed(c) ==
  /\ pc[c] = "markFailed"
  /\ row' = "failed"
  /\ Go(c, "releaseFailed")
  /\ UNCHANGED <<claim, ledger, raw, everDone, holds, seen, moved, resuming,
                 counted, day, answer, failed, failures, crashes>>

(* then releases, errors ignored, and rejects (import.ts:375-379).        *)
ReleaseFailed(c) ==
  /\ pc[c] = "releaseFailed"
  /\ ReleaseApplies(c)
  /\ Finish(c, "error")
  /\ UNCHANGED <<holds, seen>>
  /\ Frozen

(* ------------------------------ crashes -------------------------------- *)

(* The call's process dies: it takes no step again, and its claim row     *)
(* stays behind.                                                          *)
Crash(c) ==
  /\ pc[c] \notin {"idle", "end", "crashed"}
  /\ crashes < MaxCrashes
  /\ crashes' = crashes + 1
  /\ Go(c, "crashed")
  /\ UNCHANGED <<claim, row, ledger, raw, everDone, holds, seen, moved,
                 resuming, counted, day, answer, failed, failures>>

Busy ==
  \E c \in Calls :
    \/ Begin(c) \/ InsertClaim(c) \/ ReadOwner(c) \/ OwnerFinished(c)
    \/ ReleaseOwner(c) \/ Poll(c) \/ GiveUp(c) \/ TakeOver(c) \/ Renew(c)
    \/ ReadCurrent(c) \/ ReleaseSkip(c) \/ WriteRow(c) \/ ReadBack(c)
    \/ ReleaseFound(c) \/ ReleaseErr(c)
    \/ ReadLedger(c) \/ Discard(c) \/ Check(c) \/ WriteRaw(c) \/ Commit(c)
    \/ StorageFails(c) \/ MarkDone(c) \/ Release(c) \/ MarkFailed(c)
    \/ ReleaseFailed(c) \/ Crash(c)

(* Once nothing can happen, the system stays as it is. This step keeps   *)
(* /statechart from reading the end as a deadlock.                       *)
Settled == ~ENABLED Busy /\ UNCHANGED vars

Next == Busy \/ Settled

Spec == Init /\ [][Next]_vars

CallSymmetry == Permutations(Calls)

(* -------------------------------- rules -------------------------------- *)

(* No call is running: every call is yet to start, has returned, or died. *)
Quiet == \A c \in Calls : pc[c] \in {"idle", "end", "crashed"}

(* At most one call is about to write the website's analytics with no    *)
(* claim check before the write: delete uncommitted rows, store raw rows, *)
(* or commit a day.                                                       *)
OneWriter ==
  \A c, d \in Calls :
    pc[c] \in {"discard", "write", "commit"} /\ pc[d] \in {"discard", "write", "commit"}
      => c = d

(* Each day of the history is counted at most once in its rollup.        *)
CountedOnce == \A d \in DaySet : ledger[d] <= 1

(* Once no call runs, the raw rows of a counted day come from one replay: *)
(* a resume never discards a counted day's rows (replay.ts:203-205).      *)
StoredOnce ==
  Quiet => \A d \in DaySet : ledger[d] >= 1 => Cardinality(raw[d]) <= 1

(* Once no call runs, an import that says done has every day counted and *)
(* its raw rows stored.                                                   *)
NothingLost ==
  Quiet /\ row = "done" => \A d \in DaySet : ledger[d] >= 1 /\ raw[d] # {}

(* A completed import stays done.                                         *)
DoneStaysDone == everDone => row = "done"

(* A call that met no storage failure answers imported, in_progress or    *)
(* skipped.                                                               *)
CallsAnswer ==
  \A c \in Calls :
    pc[c] = "end" /\ ~failed[c] => answer[c] \in {"imported", "in_progress", "skipped"}

=============================================================================
