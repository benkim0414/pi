# Read the session footer

The footer shows directory, optional git branch, model/context placeholders, output style, and goal status when a goal exists.

## Sub-features

- `footer-path` shows the working directory.
- `footer-style` shows the effective output style.
- `footer-goal` shows standing goal status when set.

## How to get to it (user POV)

- Look at the bottom status rows of the Pi TUI after launch.
- Change style or goal and watch the footer update.

## Driving it with control-pi

Preconditions:

- `control-pi doctor` exits 0.

- **Path and style at launch.** Snapshot `footer-baseline`. Pane footer includes the workdir path and `style: Default` (or the restored style).
- **Style row.** Run `control-pi send -- '/output-style concise'`, wait ~1s, snapshot `footer-style`. Footer includes `style: Concise`.
- **Goal row.** Run `control-pi send -- '/goal Fix the parser'`, wait ~1.5s, snapshot `footer-goal`. Footer includes `⊙ active` with a budget fraction.
- **Proof.** Three snapshots showing path/style, style change, and goal row.

## Gotchas

- Branch icon appears when cwd is a git work tree (`--cwd /workspace`); disposable `/tmp` workdirs may omit the branch.
- Context shows `?` and model `unknown` without provider auth — that is expected offline.
- Emoji rendering depends on the terminal; assert on the ASCII fragments (`style:`, `⊙`) when glyphs are unreliable.
