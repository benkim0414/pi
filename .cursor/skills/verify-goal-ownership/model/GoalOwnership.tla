---- MODULE GoalOwnership ----
\* Model of packages/goal GoalController ownership + wait commit.
\* Code under check (sync against these functions):
\*   packages/goal/src/controller.ts
\*     evaluate, evaluationCheckpoint, invalidate, onHumanInput,
\*     controlGoal (pause/clear/resume), resolveWait, commitVerdict
\*   packages/goal/src/domain.ts
\*     applyVerdict, pause, resume, newGoal
\*
\* One indivisible model step = one indivisible transition in that code.
\* Out of scope: gates, drafting, process ownership, timer wakes, persistence.
\*
\* tracked = this.pending AbortController pointer (cleared by invalidate).
\* reply   = the evaluate coroutine still suspended; invalidate aborts the
\*           signal and clears tracked but does not erase reply. A late judge
\*           return can still reach the validity checks (DropStale / Judge*).

EXTENDS Integers

CONSTANTS MaxTurns
ASSUME MaxTurns \in Nat /\ MaxTurns >= 1

VARIABLES
  status,       \* "none" | "active" | "paused" | "done" | "cleared"
  used,         \* turns consumed; bumped when evaluate starts
  limit,        \* turn budget (== MaxTurns in this model)
  revision,     \* goal.revision
  epoch,        \* controller epoch; bumped by invalidate
  human,        \* human-input counter
  tracked,      \* TRUE while this.pending points at the in-flight abort
  reply,        \* TRUE while an evaluate coroutine can still return
  pEpoch,       \* epoch captured at evaluate start
  pRevision,    \* revision captured at evaluate start
  pHuman,       \* human captured at evaluate start
  waiting,      \* TRUE when goal.wait is held
  continued,    \* TRUE when the last commit issued continue:true
  lastCommit    \* "none" | "done" | "blocked" | "continue" | "wait_held" | "wait_miss" | "dropped"

vars == <<status, used, limit, revision, epoch, human,
          tracked, reply, pEpoch, pRevision, pHuman, waiting, continued, lastCommit>>

\* Tickets stay inside a small window so TLC finishes; MaxTurns keeps used finite.
MaxTicket == 4

TypeOK ==
  /\ status \in {"none", "active", "paused", "done", "cleared"}
  /\ used \in 0..MaxTurns
  /\ limit = MaxTurns
  /\ revision \in 0..MaxTicket
  /\ epoch \in 0..MaxTicket
  /\ human \in 0..MaxTicket
  /\ tracked \in BOOLEAN
  /\ reply \in BOOLEAN
  /\ pEpoch \in 0..MaxTicket
  /\ pRevision \in 0..MaxTicket
  /\ pHuman \in 0..MaxTicket
  /\ waiting \in BOOLEAN
  /\ continued \in BOOLEAN
  /\ lastCommit \in {"none", "done", "blocked", "continue",
                    "wait_held", "wait_miss", "dropped"}
  /\ tracked => reply

Init ==
  /\ status = "none"
  /\ used = 0
  /\ limit = MaxTurns
  /\ revision = 0
  /\ epoch = 0
  /\ human = 0
  /\ tracked = FALSE
  /\ reply = FALSE
  /\ pEpoch = 0
  /\ pRevision = 0
  /\ pHuman = 0
  /\ waiting = FALSE
  /\ continued = FALSE
  /\ lastCommit = "none"

\* invalidate() in controller.ts: bump epoch, abort+clear this.pending, clear wait.
\* The evaluate coroutine (reply) remains until it observes !valid() and exits.
Invalidate ==
  /\ epoch' = epoch + 1
  /\ tracked' = FALSE
  /\ waiting' = FALSE

\* Ownership ticket for committing a judge reply (checkpoint.isCurrent).
IsCurrent ==
  /\ reply
  /\ epoch = pEpoch
  /\ human = pHuman
  /\ revision = pRevision
  /\ status = "active"

FinishReply ==
  /\ tracked' = FALSE
  /\ reply' = FALSE

\* ----- control / human -----

SetGoal ==
  /\ status \in {"none", "paused", "done", "cleared"}
  /\ ~reply
  /\ epoch < MaxTicket
  /\ revision < MaxTicket
  /\ Invalidate
  /\ status' = "active"
  /\ used' = 0
  /\ revision' = revision + 1
  /\ continued' = FALSE
  /\ lastCommit' = "none"
  /\ UNCHANGED <<limit, human, reply, pEpoch, pRevision, pHuman>>

Pause ==
  /\ status = "active"
  /\ epoch < MaxTicket
  /\ revision < MaxTicket
  /\ Invalidate
  /\ status' = "paused"
  /\ revision' = revision + 1
  /\ continued' = FALSE
  /\ lastCommit' = "none"
  /\ UNCHANGED <<used, limit, human, reply, pEpoch, pRevision, pHuman>>

Clear ==
  /\ status \in {"active", "paused", "done"}
  /\ epoch < MaxTicket
  /\ revision < MaxTicket
  /\ Invalidate
  /\ status' = "cleared"
  /\ revision' = revision + 1
  /\ continued' = FALSE
  /\ lastCommit' = "none"
  /\ UNCHANGED <<used, limit, human, reply, pEpoch, pRevision, pHuman>>

Resume ==
  /\ status = "paused"
  /\ epoch < MaxTicket
  /\ revision < MaxTicket
  /\ Invalidate
  /\ status' = "active"
  /\ used' = 0
  /\ revision' = revision + 1
  /\ continued' = FALSE
  /\ lastCommit' = "none"
  /\ UNCHANGED <<limit, human, reply, pEpoch, pRevision, pHuman>>

\* onHumanInput: bumps human and aborts the signal; reply stays until DropStale.
HumanInput ==
  /\ status = "active"
  /\ human < MaxTicket
  /\ human' = human + 1
  /\ continued' = FALSE
  /\ lastCommit' = "none"
  /\ UNCHANGED <<status, used, limit, revision, epoch, waiting, tracked, reply,
                 pEpoch, pRevision, pHuman>>

\* ----- evaluate -----

\* One outstanding reply at a time so TLC can explore pause/resume → late reply
\* before a new evaluate starts. Real code can overlap; that remains out of scope.
StartEvaluate ==
  /\ status = "active"
  /\ ~waiting
  /\ ~reply
  /\ used < limit
  /\ used' = used + 1
  /\ tracked' = TRUE
  /\ reply' = TRUE
  /\ pEpoch' = epoch
  /\ pRevision' = revision
  /\ pHuman' = human
  /\ continued' = FALSE
  /\ lastCommit' = "none"
  /\ UNCHANGED <<status, limit, revision, epoch, human, waiting>>

BudgetExhaust ==
  /\ status = "active"
  /\ ~waiting
  /\ ~reply
  /\ used >= limit
  /\ revision < MaxTicket
  /\ status' = "paused"
  /\ revision' = revision + 1
  /\ waiting' = FALSE
  /\ continued' = FALSE
  /\ lastCommit' = "none"
  /\ UNCHANGED <<used, limit, epoch, human, tracked, reply, pEpoch, pRevision, pHuman>>

\* ----- judge commits / late drops -----

DropStale ==
  /\ reply
  /\ ~IsCurrent
  /\ FinishReply
  /\ continued' = FALSE
  /\ lastCommit' = "dropped"
  /\ UNCHANGED <<status, used, limit, revision, epoch, human,
                 pEpoch, pRevision, pHuman, waiting>>

JudgeDone ==
  /\ IsCurrent
  /\ FinishReply
  /\ status' = "done"
  /\ waiting' = FALSE
  /\ continued' = FALSE
  /\ lastCommit' = "done"
  /\ UNCHANGED <<used, limit, revision, epoch, human, pEpoch, pRevision, pHuman>>

JudgeBlocked ==
  /\ IsCurrent
  /\ revision < MaxTicket
  /\ FinishReply
  /\ status' = "paused"
  /\ waiting' = FALSE
  /\ revision' = revision + 1
  /\ continued' = FALSE
  /\ lastCommit' = "blocked"
  /\ UNCHANGED <<used, limit, epoch, human, pEpoch, pRevision, pHuman>>

JudgeContinue ==
  /\ IsCurrent
  /\ FinishReply
  /\ lastCommit' = "continue"
  /\ IF used >= limit
     THEN /\ revision < MaxTicket
          /\ status' = "paused"
          /\ revision' = revision + 1
          /\ waiting' = FALSE
          /\ continued' = FALSE
     ELSE /\ status' = status
          /\ revision' = revision
          /\ waiting' = waiting
          /\ continued' = TRUE
  /\ UNCHANGED <<used, limit, epoch, human, pEpoch, pRevision, pHuman>>

\* resolveWait succeeds (live process/pid or timed wait)
JudgeWaitHeld ==
  /\ IsCurrent
  /\ FinishReply
  /\ lastCommit' = "wait_held"
  /\ IF used >= limit
     THEN /\ revision < MaxTicket
          /\ status' = "paused"
          /\ revision' = revision + 1
          /\ waiting' = FALSE
          /\ continued' = FALSE
     ELSE /\ waiting' = TRUE
          /\ continued' = FALSE
          /\ UNCHANGED <<status, revision>>
  /\ UNCHANGED <<used, limit, epoch, human, pEpoch, pRevision, pHuman>>

\* No supplied target or cooldown is usable: commitVerdict pauses.
JudgeWaitMiss ==
  /\ IsCurrent
  /\ FinishReply
  /\ lastCommit' = "wait_miss"
  /\ revision < MaxTicket
  /\ status' = "paused"
  /\ revision' = revision + 1
  /\ waiting' = FALSE
  /\ continued' = FALSE
  /\ UNCHANGED <<used, limit, epoch, human, pEpoch, pRevision, pHuman>>

BarrierLifts ==
  /\ status = "active"
  /\ waiting
  /\ ~reply
  /\ waiting' = FALSE
  /\ continued' = FALSE
  /\ lastCommit' = "none"
  /\ UNCHANGED <<status, used, limit, revision, epoch, human,
                 tracked, reply, pEpoch, pRevision, pHuman>>

Idle ==
  /\ status \in {"none", "done", "cleared"}
  /\ ~reply
  /\ UNCHANGED vars

Next ==
  \/ SetGoal
  \/ Pause
  \/ Clear
  \/ Resume
  \/ HumanInput
  \/ StartEvaluate
  \/ BudgetExhaust
  \/ DropStale
  \/ JudgeDone
  \/ JudgeBlocked
  \/ JudgeContinue
  \/ JudgeWaitHeld
  \/ JudgeWaitMiss
  \/ BarrierLifts
  \/ Idle

Spec == Init /\ [][Next]_vars

\* ----- invariants -----

\* Promise: a late judge reply after pause/clear/human-abort never continues.
NoStaleContinue ==
  continued =>
    (status = "active" /\ epoch = pEpoch /\ human = pHuman /\ revision = pRevision)

\* Promise: turn counter never exceeds the budget.
BudgetOk == used <= limit

\* Promise: a cleared goal never auto-continues.
ClearedQuiet == status = "cleared" => ~continued

\* Promise: wait parks; a wait that installs no barrier must not silently continue.
\* Harm if broken: burns the turn budget when the judge names a dead pid/session.
NoSilentWaitContinue == lastCommit # "wait_miss" \/ ~continued

====
