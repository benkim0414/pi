# Persistent Goal

Private Pi 1.5.0 extension. Load from the workspace or independently with
`pi -e ./packages/goal/src/index.ts`. Requires a trusted interactive TUI session.

`/goal <objective>` starts work and keeps continuing until verified completion,
blocking, pause, clear, or the 20-run budget. User messages take priority. Each
completed user/continuation run counts once, including the first; internal tool
iterations do not count. `/goal resume` grants a fresh budget.

- `/goal` or `/goal status`: inspect progress, reason, and waiting.
- `/goal show`: inspect the contract and criteria.
- `/goal draft <objective>`: draft a contract and immediately start. An unavailable
  drafting model falls back to a plain objective with a diagnostic.
- `/goal pause`, `/goal resume`, `/goal clear`: control execution. Pause and clear
  suppress later continuation without cancelling the current agent turn.
- `/goal -- <objective>`: escape control words at the start of an objective.
- `/subgoal <criterion>`, `/subgoal`, `/subgoal remove <N>`, `/subgoal clear`:
  manage extra completion requirements.
- `/goal gate add <command>`, `/goal gate list`, `/goal gate remove <N>`,
  `/goal gate clear`: manage shell quality gates. Adding a command authorizes its
  repeated execution in the session cwd. Gates retain a bounded streaming output tail and kill their process group on timeout or abort. They run before the judge, with a
  five-minute timeout and three failed attempts before pausing. Resume resets
  attempts. Contract verification text is never executed automatically.
- `/goal wait <pid> [reason]` and `/goal unwait`: park on a local PID or release
  waiting. The judge can also request process-session or timed waits. If none of
  the supplied targets or cooldowns is usable, the goal pauses with a reason;
  `/goal resume` restarts it.

Aliases: continue/unpause resume; stop/done clear; gate rm removes. Control words
pause/resume/status/show/unwait accept trailing text with a diagnostic; use `--`
when those words belong to an objective. Replacement is rejected while busy.

Inline contracts accept outcome, verify/verification/verified by,
constraints/preserve, boundaries/scope, and stop when/stop_when/blocked fields:

```text
/goal Fix the parser
verify: parser regression tests pass with output shown
preserve: public API
scope: parser and its tests
stop when: a public API change is necessary
```

The auxiliary judge uses the current model by default. Configure `goal.json` in
Pi's agent directory or trusted project `.pi` directory (project overrides):

```json
{
	"maxTurns": 20,
	"judge": { "provider": "provider-name", "model": "model-id" }
}
```

Judge calls use a 30-second timeout and 4096 output tokens. Temporary failures
continue within the budget; three consecutive malformed replies or five network
failures pause. Judging is model-based and can be wrong. Status reports its reason.

The `goal_process` tool starts and controls owned background terminals on Linux
and macOS through the official Pi Env local daemon. It offers start/list/output/
input/stop, literal `patterns`, 64,000-character output retention, and completion
notifications for waiting. Process ownership is session-local. Shutdown, reload,
and session replacement terminate owned terminals; restoring a goal never
restarts shell commands. PID/session waits have a 30-minute ceiling; timed waits
use their deadline. Waiting does not consume turns or judge calls.

State persists in Pi session entries across resume and compaction. Forks and tree
navigation inherit paused goals. Escape pauses automatic work. New sessions start
empty. Existing output styles, tools, and system instructions stay active. Goals
provide no additional permissions; normal repository approval requirements apply.
Print, JSON, and RPC modes do not execute goals or write goal state.

Run `npm run check --workspace goal` or `npm run check`. Automated tests use fake judge
responses and real local terminals without provider credentials.

## Code structure

The entrypoint delegates Pi lifecycle registration to `src/session.ts`. Command,
session, and process-tool adapters translate Pi input into intent. `GoalController`
is the goal execution module: its interface owns transitions, drafting and
evaluation lifetimes, cancellation, wake scheduling, persistence, and session
resources. Goal state and coordination flags are private; inspection returns a
snapshot. Criteria and gate edits share the same transition implementation.

Tests cross the controller interface to verify observable transitions, with
extension tests retaining coverage of Pi event sequences and asynchronous races.
Auxiliary model requests, gate execution, and process ownership retain their
existing seams. Domain parsing and transitions remain independent of Pi and I/O.
The persisted goal remains a plain versioned object.

Async completion and cleanup retain ownership checks. Only one current evaluation
owns a turn; new human input releases that ownership while obsolete requests wind
down. Session restoration checks lifecycle ownership independently of human input.
Accepted continuations consume their pending wake, and failed wakes superseded by
human input retry once the session permits it.
