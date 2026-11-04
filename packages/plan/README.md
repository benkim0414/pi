# Plan

Private Pi extension, version 1.0.0. Load with `pi -e ./packages/plan/src/index.ts`
from the workspace, or load the package independently with `pi -e .` from this directory.
The root workspace also registers this extension.

Use `/plan <task>` to request an implementation plan. `/plan` infers the task from
conversation or asks for clarification. The command requires an idle trusted TUI
session. Busy and untrusted requests are rejected; print, JSON, and RPC are unaffected.

The agent is instructed to save Markdown under `.pi/plans/` in the current working
directory, respecting repository destinations and worktree rules. It reports the
actual path or a save failure. The extension does not itself write the plan.

Restrictions apply to one turn and are model instructions, not a sandbox. Subsequent
requests use normal Pi behavior. There is no automatic execution, settings file,
footer indicator, or tool restriction. Existing output styles remain active.

Run `npm run check --workspace plan` or `npm run check` for verification.

## Code structure

The command adapter delegates instruction construction to the pure prompt builder. This small extension retains its existing structure.
