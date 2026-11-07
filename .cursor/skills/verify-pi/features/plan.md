# Request an implementation plan

`/plan` asks the agent to write an implementation plan for one turn without executing the task. Starting the command requires an idle trusted TUI session; finishing the plan needs a working model provider.

## Sub-features

- `plan-start` submits the planning turn from `/plan` or `/plan <task>`.
- `plan-save` (auth required) saves Markdown under `.pi/plans/` in the workdir.

## How to get to it (user POV)

- Run `/plan`.
- Run `/plan <task>`.

## Driving it with control-pi

Preconditions:

- `control-pi doctor` exits 0.
- Session idle.

- **Start without auth (expected skip of save).** Run `control-pi send -- '/plan add a smoke test'`. Wait ~1.5s. Snapshot `plan-start`. If no provider is configured, the pane shows an API key / no-models error and no plan file appears under `$WORKDIR/.pi/plans/`. Record `plan-save` as blocked with that precondition.
- **Start with auth (full path).** Only when `pi auth check --provider <ready-provider>` succeeds: run the same `/plan` command, wait for the turn to finish, then confirm a new file matching `.pi/plans/*-*.md` exists and snapshot `plan-saved`. Read the file path from the assistant reply when present.
- **Proof.** Snapshot of the start attempt; either the blocked-precondition note or the saved plan path copied into evidence.

## Gotchas

- Busy or untrusted sessions reject `/plan` with a notification — do not treat that as a successful plan.
- Print/JSON/RPC modes are unaffected by design; do not use them for this feature.
- Restrictions apply to one turn only; do not continue chatting in the same proof expecting planning constraints to hold.
