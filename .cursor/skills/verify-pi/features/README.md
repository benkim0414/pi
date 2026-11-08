# Pi extensions verification map

This directory is the maintained source for verifying user-facing behavior of the workspace Pi extensions (goal, plan, output-styles, footer). Read this index before driving, then use the matching feature file as the recipe.

## Baseline preconditions

- Install deps from the repo root with `npm ci`.
- Put `.cursor/skills/verify-pi/bin` on `PATH`.
- Launch with `RUN_ID="$(control-pi launch)"` and `export PI_VERIFY_RUN_ID="$RUN_ID"`.
- Run `control-pi doctor` and require exit 0.
- Prefer the disposable workdir from launch. Use `--cwd /workspace` only when a recipe says so.
- Never drive a Pi instance that was not started by `control-pi launch`.

## Driving conventions

- Start every recipe from a freshly launched instance unless its preconditions say otherwise.
- Treat slash commands as literal. Keep flags and names unchanged.
- Run TUI actions through `control-pi send` / `control-pi keys`.
- Snapshot with `control-pi snapshot --name <id>` after each observable step.
- Restore mutable project-local files only inside the disposable workdir (cleanup removes it).

## Proof and skip reporting

- Capture the user action and the resulting pane/footer, not only the final screen.
- TUI proof is a pane transcript under `/tmp/pi-verify-evidence/<RUN_ID>/`.
- Mutation proof includes a second view (footer status and/or saved settings file).
- Record the feature ID and entry point in `proof.md` beside the snapshots.
- Report an unreachable path with the attempted command and the unmet precondition (for example `pi auth check` not ready).
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph. It then uses exactly four H2 sections: `Sub-features`, `How to get to it (user POV)`, `Driving it with control-pi`, and `Gotchas`.

## Features

- [Inspect goal status](./goal-status.md) covers empty status and status after set.
- [Control a standing goal](./goal-control.md) covers set, pause, and clear without requiring a successful model turn.
- [Select an output style](./output-style.md) covers picker inspect, named select, and footer/settings proof.
- [Read the session footer](./footer.md) covers directory, style, and goal status rows.
- [Request an implementation plan](./plan.md) covers `/plan` start; full save needs provider auth.
