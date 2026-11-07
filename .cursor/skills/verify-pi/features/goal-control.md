# Control a standing goal

Users set a standing objective, pause automatic work, and clear the goal. Pause and clear must update the footer without depending on a successful judge turn.

## Sub-features

- `goal-set` creates an active goal with a turn budget.
- `goal-pause` marks the goal paused.
- `goal-clear` removes the standing goal.

## How to get to it (user POV)

- Run `/goal <objective>` or `/goal -- <objective>`.
- Run `/goal pause`.
- Run `/goal clear` (aliases `stop` / `done`).

## Driving it with control-pi

Preconditions:

- `control-pi doctor` exits 0.
- Session has no standing goal.

- **Set.** Run `control-pi send -- '/goal Fix the parser'`. Wait ~1.5s. Snapshot `goal-set`. Pane shows `Goal set` and footer includes `⊙ active` with a `0/20` (or configured) budget.
- **Pause.** Run `control-pi send -- '/goal pause'`. Wait ~1s. Snapshot `goal-pause`. Footer shows `⊙ paused`.
- **Clear.** Run `control-pi send -- '/goal clear'`. Wait ~1s. Snapshot `goal-clear`. Pane shows `Goal cleared.` and the footer goal row is gone (only `style:` remains among extension statuses).
- **Proof.** Retain the three snapshots. Note any API-key error after set; control transitions must still succeed.

## Gotchas

- Setting a goal without auth still creates the goal, then errors on continuation submit.
- Pause/clear do not cancel an in-flight agent turn in product docs; in offline verify there is usually no in-flight turn after the failed submit.
- Replacement while busy is rejected; keep the session idle between commands.
