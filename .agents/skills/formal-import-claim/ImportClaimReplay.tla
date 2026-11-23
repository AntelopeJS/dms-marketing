--------------------------- MODULE ImportClaimReplay ---------------------------
(***************************************************************************)
(* The replay of ImportClaim: the ledger read, the discard, the raw writes *)
(* and the day commit, the import row's last writes, the crashes, the      *)
(* funnel trail steps, and the next-state relation.                        *)
(***************************************************************************)
EXTENDS ImportClaim

(* ------------------------------ replaying ------------------------------ *)

(* A resumed replay reads which days the ledger names (replay.ts:287-289, *)
(* 253-269); a new one starts from the first day. A resume also lists the *)
(* raw rows of the days the ledger does not name, then, when it found any, *)
(* moves the backfill generation and takes those rows out of the trails   *)
(* (replay.ts:219-221, 238-241). The model does this here, before the     *)
(* isHeld() check that Discard holds: a call that fails that check took   *)
(* entries out that the raw rows keep, which no trail rule reads.         *)
ReadLedger(c) ==
  /\ pc[c] = "ledger"
  /\ IF resuming[c]
     THEN LET named == {d \in DaySet : ledger[d] > 0}
              rows == [d \in DaySet |->
                         IF d \in named \/ ~TrailsTracked THEN {} ELSE raw[d]]
              found == \E d \in DaySet : rows[d] # {}
          IN /\ counted' = [counted EXCEPT ![c] = named]
             /\ listed' = [listed EXCEPT ![c] = rows]
             /\ gen' = IF found THEN gen + 1 ELSE gen
             /\ trail' = [d \in DaySet |-> trail[d] \ rows[d]]
             /\ Go(c, "discard") /\ UNCHANGED day
     ELSE /\ day' = [day EXCEPT ![c] = 1]
          /\ Go(c, "check") /\ UNCHANGED <<counted, listed, gen, trail>>
  /\ UNCHANGED <<claim, row, ledger, raw, everDone, holds, seen, moved,
                 resuming, answer, failed, failures, crashes, lost, fence,
                 fenceOf, tail, walks, wpc, wgen, wread, wrote>>

(* discardUncommitted deletes the import's raw rows on every day that    *)
(* ledger read did not name (replay.ts:289-292, 205-253), after an       *)
(* isHeld() check that throws once it is false (replay.ts:290).           *)
Discard(c) ==
  /\ pc[c] = "discard"
  /\ IF holds[c]
     THEN /\ raw' = [d \in DaySet |-> IF d \in counted[c] THEN raw[d] ELSE {}]
          /\ day' = [day EXCEPT ![c] = NextDay(1, counted[c])]
          /\ Go(c, "check")
          /\ tail' = [tail EXCEPT ![c] =
                         IF \E d \in DaySet : listed[c][d] # {}
                         THEN "fence" ELSE "none"]
     ELSE Go(c, "markFailed") /\ UNCHANGED <<raw, day, tail>>
  /\ UNCHANGED <<claim, row, ledger, everDone, holds, seen, moved, resuming,
                 counted, answer, failed, failures, crashes, lost, fence,
                 fenceOf, trail, gen, listed, walks, wpc, wgen, wread, wrote>>

(* A worker checks isHeld() before each visitor and throws once it is     *)
(* false (replay.ts:168, 192-197). With no day left, the replay returns.  *)
Check(c) ==
  /\ pc[c] = "check"
  /\ Go(c, IF day[c] > Days THEN "markDone"
           ELSE IF holds[c] THEN "write" ELSE "markFailed")
  /\ UNCHANGED <<claim, holds, seen, moved, answer>>
  /\ Frozen

(* replayVisitor writes the day's raw events and sessions through        *)
(* ingestPreparedBatch and holds the rollup in memory (replay.ts:170-175).*)
WriteRaw(c) ==
  /\ pc[c] = "write"
  /\ raw' = [raw EXCEPT ![day[c]] = @ \cup {c}]
  /\ Go(c, "commit")
  /\ UNCHANGED <<claim, row, ledger, everDone, holds, seen, moved, resuming,
                 counted, day, answer, failed, failures, crashes, lost, fence,
                 fenceOf>>
  /\ UNCHANGED trailVars

(* commitImportedDay adds the day's counters and its ledger entry in one  *)
(* write to the day row, with no look at the claim (replay.ts:301-306,    *)
(* rollup.ts:121-157, 183-193). Then the next day the ledger read did not *)
(* name.                                                                  *)
Commit(c) ==
  /\ pc[c] = "commit"
  /\ ledger' = [ledger EXCEPT ![day[c]] = @ + 1]
  /\ day' = [day EXCEPT ![c] = NextDay(day[c] + 1, counted[c])]
  /\ Go(c, "check")
  /\ UNCHANGED <<claim, row, raw, everDone, holds, seen, moved, resuming,
                 counted, answer, failed, failures, crashes, lost, fence,
                 fenceOf>>
  /\ UNCHANGED trailVars

(* A raw write or a day commit fails in storage, and replayAll throws.    *)
StorageFails(c) ==
  /\ pc[c] \in {"write", "commit"}
  /\ failures < MaxFailures
  /\ failures' = failures + 1
  /\ failed' = [failed EXCEPT ![c] = TRUE]
  /\ Go(c, "markFailed")
  /\ UNCHANGED <<claim, row, ledger, raw, everDone, holds, seen, moved,
                 resuming, counted, day, answer, crashes, lost, fence, fenceOf>>
  /\ UNCHANGED trailVars

(* The import row is set done under the call's fence (import.ts:435-441).*)
MarkDone(c) ==
  /\ pc[c] = "markDone"
  /\ IF Fenced(c)
     THEN /\ row' = "done" /\ everDone' = TRUE /\ NewFence(c)
          /\ Go(c, "release")
     ELSE Go(c, "readBack") /\ UNCHANGED <<row, everDone, fence, fenceOf>>
  /\ UNCHANGED <<claim, ledger, raw, holds, seen, moved, resuming, counted,
                 day, answer, failed, failures, crashes, lost>>
  /\ UNCHANGED trailVars

(* release(), its error ignored, then "imported": another call's          *)
(* ownerFinished may have deleted the claim of this done import           *)
(* (import.ts:442-443, claim.ts:142-143).                                 *)
Release(c) ==
  /\ pc[c] = "release"
  /\ ReleaseApplies(c)
  /\ Finish(c, "imported")
  /\ UNCHANGED <<holds, seen>>
  /\ Frozen

(* The catch of a call whose renewal saw another token leaves the row to  *)
(* the taker: release() has no token to delete, and the call answers      *)
(* "in_progress" (import.ts:445-448). Otherwise it sets the import row    *)
(* failed under its fence (import.ts:449-459).                            *)
MarkFailed(c) ==
  /\ pc[c] = "markFailed"
  /\ IF ~holds[c]
     THEN Finish(c, "in_progress") /\ UNCHANGED <<row, fence, fenceOf>>
     ELSE IF Fenced(c)
     THEN /\ row' = "failed" /\ NewFence(c)
          /\ Go(c, "releaseFailed") /\ UNCHANGED answer
     ELSE Go(c, "readBack") /\ UNCHANGED <<row, fence, fenceOf, answer>>
  /\ UNCHANGED <<claim, ledger, raw, everDone, holds, seen, moved, resuming,
                 counted, day, failed, failures, crashes, lost>>
  /\ UNCHANGED trailVars

(* then releases, errors ignored, and rejects (import.ts:460-464).        *)
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
                 resuming, counted, day, answer, failed, failures, lost, fence,
                 fenceOf>>
  /\ UNCHANGED trailVars

(* ------------------------------ funnel trails -------------------------- *)

callVars == <<claim, row, ledger, raw, everDone, pc, holds, seen, moved,
              resuming, counted, day, answer, failed, failures, crashes, lost,
              fence, fenceOf>>

(* ingestPreparedBatch writes the day's events, then adds them to their  *)
(* session's trail before it returns (collect.ts:174-185, 197-211). A    *)
(* trail write that never lands, as when the call dies first, leaves the  *)
(* entry to the backfill.                                                 *)
TrailWrite(c) ==
  /\ TrailsTracked
  /\ pc[c] = "commit"
  /\ c \notin trail[day[c]]
  /\ trail' = [trail EXCEPT ![day[c]] = @ \cup {c}]
  /\ UNCHANGED <<gen, listed, tail, walks, wpc, wgen, wread, wrote>>
  /\ UNCHANGED callVars

(* Once its deletes are done, discardUncommitted moves the generation     *)
(* again, then takes the rows it listed out of the trails once more       *)
(* (replay.ts:246-251). The model lets these two steps run at any later  *)
(* point, which covers the code's order, and a call that dies first never *)
(* runs them.                                                             *)
TailFence(c) ==
  /\ tail[c] = "fence" /\ pc[c] # "crashed"
  /\ gen' = gen + 1
  /\ tail' = [tail EXCEPT ![c] = "forget"]
  /\ UNCHANGED <<trail, listed, walks, wpc, wgen, wread, wrote>>
  /\ UNCHANGED callVars

TailForget(c) ==
  /\ tail[c] = "forget" /\ pc[c] # "crashed"
  /\ trail' = [d \in DaySet |-> trail[d] \ listed[c][d]]
  /\ tail' = [tail EXCEPT ![c] = "none"]
  /\ UNCHANGED <<gen, listed, walks, wpc, wgen, wread, wrote>>
  /\ UNCHANGED callVars

(* A backfill walk of the website reads the generation, then its events, *)
(* then flushes: it checks the generation, adds what the trails did not  *)
(* hold, checks the generation again and takes its own additions back    *)
(* when it moved (trail-backfill.ts:87, 129-161, 163-192).              *)
WalkBegin ==
  /\ wpc = "idle" /\ walks < Walks
  /\ walks' = walks + 1 /\ wgen' = gen /\ wpc' = "read"
  /\ UNCHANGED <<trail, gen, listed, tail, wread, wrote>>
  /\ UNCHANGED callVars

WalkRead ==
  /\ wpc = "read"
  /\ wread' = raw /\ wpc' = "flush"
  /\ UNCHANGED <<trail, gen, listed, tail, walks, wgen, wrote>>
  /\ UNCHANGED callVars

WalkCheck ==
  /\ wpc = "flush"
  /\ wpc' = IF gen = wgen THEN "write" ELSE "idle"
  /\ UNCHANGED <<trail, gen, listed, tail, walks, wgen, wread, wrote>>
  /\ UNCHANGED callVars

WalkWrite ==
  /\ wpc = "write"
  /\ wrote' = [d \in DaySet |-> wread[d] \ trail[d]]
  /\ trail' = [d \in DaySet |-> trail[d] \cup wread[d]]
  /\ wpc' = "check"
  /\ UNCHANGED <<gen, listed, tail, walks, wgen, wread>>
  /\ UNCHANGED callVars

WalkRecheck ==
  /\ wpc = "check"
  /\ wpc' = IF gen = wgen THEN "idle" ELSE "forget"
  /\ UNCHANGED <<trail, gen, listed, tail, walks, wgen, wread, wrote>>
  /\ UNCHANGED callVars

WalkForget ==
  /\ wpc = "forget"
  /\ trail' = [d \in DaySet |-> trail[d] \ wrote[d]]
  /\ wpc' = "idle"
  /\ UNCHANGED <<gen, listed, tail, walks, wgen, wread, wrote>>
  /\ UNCHANGED callVars

Busy ==
  \/ \E c \in Calls :
       \/ Begin(c) \/ InsertClaim(c) \/ ReadOwner(c) \/ OwnerFinished(c)
       \/ ReleaseOwner(c) \/ Poll(c) \/ GiveUp(c) \/ TakeOver(c) \/ Renew(c)
       \/ ReadCurrent(c) \/ ReleaseSkip(c) \/ WriteRow(c) \/ ReadBack(c)
       \/ ReleaseFound(c) \/ ReleaseErr(c)
       \/ ReadLedger(c) \/ Discard(c) \/ Check(c) \/ WriteRaw(c) \/ Commit(c)
       \/ StorageFails(c) \/ MarkDone(c) \/ Release(c) \/ MarkFailed(c)
       \/ ReleaseFailed(c) \/ Crash(c)
       \/ TrailWrite(c) \/ TailFence(c) \/ TailForget(c)
  \/ WalkBegin \/ WalkRead \/ WalkCheck \/ WalkWrite \/ WalkRecheck
  \/ WalkForget

(* Once nothing can happen, the system stays as it is. This step keeps   *)
(* /statechart from reading the end as a deadlock.                       *)
Settled == ~ENABLED Busy /\ UNCHANGED vars

Next == Busy \/ Settled

Spec == Init /\ [][Next]_vars

CallSymmetry == Permutations(Calls)

=============================================================================
