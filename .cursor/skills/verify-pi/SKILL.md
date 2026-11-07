---

name: verify-pi
description: "Drive this repo's Pi TUI extensions (goal, plan, output-styles, footer) the way a user does via tmux. Use when proving slash-command or footer behavior, or after changing packages/goal, plan, output-styles, or footer."
---

# Verify Pi extensions

This workspace is a Pi 1.5.0 extension package. Users touch an interactive Pi TUI with `/goal`, `/plan`, `/output-style`, and a themed footer. Prove changes by driving that TUI, not by calling controller methods from tests.

## Surface

- **Primary:** Pi interactive TUI with workspace extensions loaded via `-e`.
- **Not primary:** Vitest fixtures (they fake Pi). Print / JSON / RPC modes do not run goals or write goal state — do not use them as the user path for goal/plan.

## Launch

From the repo root, after `npm ci`:

```bash
export PATH="$PWD/.cursor/skills/verify-pi/bin:$PATH"
RUN_ID="$(control-pi launch)"
export PI_VERIFY_RUN_ID="$RUN_ID"
```

`control-pi launch` starts a dedicated tmux session, disposable workdir under `/tmp/pi-verify-runs/<RUN_ID>/`, isolated `--session-dir`, and loads:

- `packages/footer/src/index.ts`
- `packages/output-styles/src/index.ts`
- `packages/plan/src/index.ts`
- `packages/goal/src/index.ts`

**Ready:** pane contains `[Extensions]` at startup and an ongoing `style:` footer line. `control-pi doctor` must exit 0 before driving.

Optional: `control-pi launch --cwd /workspace` when a recipe needs the real repo tree (branch footer). Prefer the default disposable workdir so `.pi/output-styles/settings.local.json` does not pollute the project.

**Teardown:** `control-pi cleanup` (keeps evidence under `/tmp/pi-verify-evidence/<RUN_ID>/`).

Never attach to a Pi session you did not launch with `control-pi`.

## Doctor

```bash
control-pi doctor
```

Requires: tmux session alive, `style:` footer visible, run state file present. Re-run after any odd pane before capturing proof.

## Drive

Harness: **`control-pi`** (tmux PTY).

```bash
control-pi send -- '/goal status'
control-pi keys -- Escape
control-pi snapshot --name after-status
control-pi capture --path "$HOME/tmp-pane.txt"   # optional override
control-pi env
```

- Prefer exact slash commands from the feature map (`/goal`, `/output-style concise`, …).
- Wait ~0.5–1.5s after sends that open pickers or mutate status before snapshotting.
- Escape cancels the output-style picker without saving.

Read recipes under `features/`. Drive every entry point a feature lists, or report the unmet precondition (for example missing provider auth) — do not claim a different path verified the skipped one.

## Evidence

Store under `/tmp/pi-verify-evidence/<RUN_ID>/` (override with `PI_VERIFY_ARTIFACTS_ROOT`).

Proof standards:

- Real slash commands in the live TUI — not `GoalController` unit calls.
- Capture the pane **after the action** and again for the resulting footer/status.
- For mutations (style save, goal set/pause/clear), also check a second observable: footer line and/or `.pi/output-styles/settings.local.json` under the run workdir.
- Record feature ID and entry point in a short `proof.md` next to the snapshots.

Mocks: only the absence of a provider is acceptable (Pi starts with “No models available”). Features that need a model turn (`/plan` completion, goal auto-continue/judge) must fail closed with that precondition unless `pi auth check` is ready.

## Cleanup

```bash
control-pi cleanup
```

Kills the tmux session and deletes `/tmp/pi-verify-runs/<RUN_ID>/`. Does **not** delete `/tmp/pi-verify-evidence/<RUN_ID>/`.

## Helpers

| Command                        | Role                                     |
| ------------------------------ | ---------------------------------------- |
| `control-pi launch`            | Start isolated instance; prints `RUN_ID` |
| `control-pi doctor`            | Health check                             |
| `control-pi send -- <text>`    | Type + Enter                             |
| `control-pi keys -- …`         | Raw tmux keys                            |
| `control-pi snapshot --name N` | Pane → artifacts                         |
| `control-pi cleanup`           | Tear down scratch; keep evidence         |

Make sure `bin/control-pi` is executable. Put `bin` on `PATH` as shown in Launch.

## Feature map

See [`features/README.md`](features/README.md).
