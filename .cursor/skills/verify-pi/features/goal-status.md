# Inspect goal status

Goal status shows whether a standing objective is active and why, without starting new work when the goal list is empty.

## Sub-features

- `goal-status-empty` reports that no goal is set.
- `goal-status-active` shows progress after a goal has been set.

## How to get to it (user POV)

- Run `/goal` with no arguments.
- Run `/goal status`.

## Driving it with control-pi

Preconditions:

- `control-pi doctor` exits 0.
- No standing goal yet in this session.

- **Empty status via `/goal`.** Run `control-pi send -- '/goal'`. Wait ~1s. Run `control-pi snapshot --name goal-status-empty`. The pane contains `No goal set.`
- **Empty status via alias.** On a fresh launch (or after `/goal clear`), run `control-pi send -- '/goal status'`. Snapshot `goal-status-alias`. The pane again contains `No goal set.`
- **Status after set.** Run `control-pi send -- '/goal Fix the parser'`, wait ~1.5s, then `control-pi send -- '/goal status'`. Snapshot `goal-status-active`. The pane or footer shows an active goal (`⊙ active` and/or objective text). A runtime error about missing API keys may appear after set; status must still reflect the goal.
- **Proof.** Keep both empty and active snapshots plus a one-line note of which entry point was used.

## Gotchas

- `/goal Fix…` tries to submit a continuation. Without provider auth the pane shows an API key error; that does not cancel the set goal.
- Do not use print/RPC mode; goals do not execute there.
- After `/goal clear`, the footer goal row disappears — re-check empty status from that state if reusing the session.
