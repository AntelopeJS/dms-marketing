--------------------------- MODULE ImportClaimRules ---------------------------
(***************************************************************************)
(* The rules TLC checks on ImportClaim, the model of the ImportAnalytics  *)
(* claim and replay. Every configuration names its rules from here.      *)
(***************************************************************************)
EXTENDS ImportClaim

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
(* a resume never discards a counted day's rows (replay.ts:214-220).      *)
StoredOnce ==
  Quiet => \A d \in DaySet : ledger[d] >= 1 => Cardinality(raw[d]) <= 1

(* Once no call runs, an import that says done has every day counted and *)
(* its raw rows stored.                                                   *)
NothingLost ==
  Quiet /\ row = "done" => \A d \in DaySet : ledger[d] >= 1 /\ raw[d] # {}

(* A completed import stays done.                                         *)
DoneStaysDone == everDone => row = "done"

(* A call whose import-row insert or fenced resume failed only answers   *)
(* (import.ts:305-326, 274-297).                                          *)
LoserWritesNothing ==
  \A c \in Calls :
    lost[c] => pc[c] \in {"readBack", "releaseSkip", "releaseFound", "releaseErr",
                         "end", "crashed"}

(* A call that met no storage failure answers imported, in_progress or    *)
(* skipped.                                                               *)
CallsAnswer ==
  \A c \in Calls :
    pc[c] = "end" /\ ~failed[c] => answer[c] \in {"imported", "in_progress", "skipped"}

=============================================================================
