---

name: verify-goal-ownership
description: "Formally check GoalController ownership and wait-commit promises with TLA+/TLC. Use when changing packages/goal evaluate, invalidate, commitVerdict, resolveWait, pause/clear/resume, or turn budget — or when a goal keeps running after pause/clear/wait."
---

# Verify goal ownership

A standing goal must not keep driving the agent after the user pauses, clears, or types, and a wait must park — not silently burn the turn budget. This skill model-checks those promises against `GoalController`.

## When to use

Run this skill when a change touches any of:

- `packages/goal/src/controller.ts` — `evaluate`, `evaluationCheckpoint`, `invalidate`, `onHumanInput`, `controlGoal`, `resolveWait`, `commitVerdict`
- `packages/goal/src/domain.ts` — `applyVerdict`, `pause`, `resume`, `newGoal`

If the change is intentional (new promise), update the model and this skill, then move the sync commit only after TLC matches the new code.

## Property (plain words)

| Invariant              | Promise                                                                         | Harm if broken                                |
| ---------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| `NoStaleContinue`      | A late judge reply after pause, clear, or human input never continues the goal. | Agent keeps working on a paused/cleared goal. |
| `BudgetOk`             | `used` never exceeds `limit`.                                                   | Unbounded autonomous loops.                   |
| `ClearedQuiet`         | A cleared goal never auto-continues.                                            | Cleared work resurrects.                      |
| `NoSilentWaitContinue` | A wait that installs no barrier must not fall through to `continue:true`.       | Dead pid/session waits burn the budget.       |

## Tool and why

**TLA+ / TLC** (via pstack `/statechart` when available). The risk is interleaving of discrete events (settle, judge reply, pause/clear, human input, wait miss/hold). Model checking explores those orders; TypeScript has no practical code-level model checker for this.

Bounds: `MaxTurns = 2`, ticket counters capped at `MaxTicket = 4` inside the spec. That is enough for ownership and wait-miss; it is not a proof at production `maxTurns` (default 20).

## Coverage record

- **Model:** `.cursor/skills/verify-goal-ownership/model/GoalOwnership.tla`
- **Configs:** `GoalOwnership.cfg` (all invariants), `GoalOwnershipOwnershipOnly.cfg` (checks ownership separately from wait admission)
- **View:** `model/view.mjs` (reader labels for `/statechart`)
- **Code:** functions listed above in `controller.ts` / `domain.ts`
- **Sync commit:** `79a09a4a98401bc1612e4248c78ad6609b333d2c` — controller and model verified together; all five invariants pass across 2,117 states.
- **Out of scope:** gates, drafting, process ownership, timer wakes, persistence, overlapping evaluates that overwrite `pending` without aborting the first

## How to run

From the repo root:

```bash
# 1) Ensure TLC
mkdir -p ~/.local/share/tla
test -f ~/.local/share/tla/tla2tools.jar || curl -fsSL -o ~/.local/share/tla/tla2tools.jar \
  https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar
export TLA2TOOLS=~/.local/share/tla/tla2tools.jar
export JAVA="$(command -v java)"

# 2) Full check (all invariants must pass)
.cursor/skills/verify-goal-ownership/run.sh all /tmp/goal-ownership-out

# 3) Ownership-only check (must pass: NoStaleContinue, BudgetOk, ClearedQuiet, TypeOK)
.cursor/skills/verify-goal-ownership/run.sh ownership /tmp/goal-ownership-pass
```

Always read TLC results with pstack **`/statechart`**. It turns each broken invariant into the shortest path in plain words. Do not hard-code `statechart` CLI flags from memory — resolve the skill and follow it.

Exit codes from `run.sh`: `0` all checked invariants hold; `1` an invariant breaks; `2` tool/setup failure.

## Regression: unavailable wait target

The original defect let a judge wait with no usable target fall through to
`continue: true`. The controller now tries process session, PID, then cooldown;
if none is usable, it pauses with a reason and requires `/goal resume`.
Budget exhaustion still takes precedence.

`JudgeWaitMiss` models that pause. Both configs must pass. The standalone replay
asserts a paused goal and no continuation; normal controller tests also cover
unavailable targets, fallback order, resume, cooldown release, and budget precedence.

```bash
cd .cursor/skills/verify-goal-ownership && npx vitest run --config vitest.config.ts
```

Do **not** weaken `NoSilentWaitContinue` to make TLC green. Change product behavior only when the user authorizes it. Keep the ownership-only config for focused ownership checks.

## Tell a modeling error from a real bug

1. Take the `/statechart` path for the broken rule.
2. Replay each step against `GoalController` (test or TUI).
3. If a step cannot happen in the code, the model is wrong — fix the model, not the property.
4. If every step can happen, it is a product bug — report it; leave the invariant failing.

## After an intentional promise change

1. Edit `GoalOwnership.tla` so each step still names real code.
2. Update the tables in this skill.
3. Run both configs; for a new bug, show a broken variant that the invariant catches.
4. Set **Sync commit** below to `git rev-parse HEAD` only after the model describes that commit.

## Scratch-break discipline

Before trusting a green ownership-only run after you edit the model, replace `JudgeContinue`'s `IsCurrent` guard with `reply /\ status = "active"`, run the ownership-only config, and confirm `NoStaleContinue` fails on a path like: set goal → judge starts → you pause → you resume → judge says continue. Then restore the guard and re-run until ownership is green again. A check that has never failed proves nothing.

---

**Sync commit:** `79a09a4a98401bc1612e4248c78ad6609b333d2c`
