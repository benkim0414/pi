# Output styles

Reusable communication and collaboration preferences for Pi's interactive coding
agent. Select a built-in or custom style for subsequent agent runs without restarting
Pi. Styles add instructions; Pi's coding instructions and permissions remain active.

## Load locally

Install the workspace dependencies, then start a development session:

```sh
npm ci
npm run dev --workspace output-styles
```

This runs `pi -e .` inside this package. To use the extension in another project,
run Pi from that project with the absolute package path:

```sh
pi -e /absolute/path/to/pi/packages/output-styles
```

Loading through `-e` lasts for this Pi process; it does not save a package declaration
in Pi settings. Pi 1.5.0 is the development and validation target.

## Select a style

Run `/output-style` to inspect the styles, their sources, and the current choice in
a picker. Escape cancels without changes. Names complete as you type.

```text
/output-style concise
/output-style Explanatory
/output-style ASD-STE100
/output-style ELI5
/output-style default
```

Names are case-insensitive in commands and may contain spaces. The status bar shows
the effective style. Selection applies on the next agent run; it does not rewrite a
response already in progress. An unknown name leaves the selection unchanged.

The footer uses a writing emoji, a muted `style:` label, and the style name in
normal text, for example `📝 style: ELI5`. Default stays visible as
`📝 style: Default`. If a saved choice is unavailable, the footer shows
`📝 style: Default (<requested name> unavailable)` until it is repaired or changed.

| Style       | Behavior                                                                    |
| ----------- | --------------------------------------------------------------------------- |
| Default     | Pi's normal instructions with no added output style                         |
| Proactive   | Start authorized work promptly and make routine assumptions                 |
| Concise     | Lead with the result and keep responses brief                               |
| Explanatory | Explain engineering choices in short Insight blocks                         |
| Learning    | Explain choices and invite a small TODO(human) coding exercise              |
| ASD-STE100  | Use practical Simplified Technical English for clear technical answers      |
| ELI5        | Use small words and short explanations, preserving exact paths and commands |

Proactive, Concise, Explanatory, and Learning are Pi-authored equivalents inspired by
[Claude Code's built-ins](https://code.claude.com/docs/en/output-styles), not copies
of proprietary prompts. Explicit user instructions take precedence. Proactive
grants no additional tool permissions. Learning may deliberately pause for your
contribution and must report unfinished work.

ASD-STE100 and ELI5 bundle the existing Pi output-style definitions from the
maintainer's dotfiles, preserving their wording without requiring those files at
runtime. ASD-STE100 is practical writing guidance, not a claim of certified
compliance or verified dictionary use. Both are available immediately; adding
them does not change your saved selection or the Default fallback. Personal and
project definitions with the same names continue to override these built-ins.

## Custom styles

Create an immediate `.md` file in either location:

- Personal: `<Pi agent directory>/output-styles/`, normally
  `~/.pi/agent/output-styles/`. Pi's `PI_CODING_AGENT_DIR` override is respected.
- Project: `.pi/output-styles/` in your working directory or an ancestor through
  the Git worktree root. Outside Git, only the working directory is searched.

For example, save `diagrams.md`:

```md
---
name: Diagrams first
description: Explain structure with a small diagram
---

When explaining architecture or data flow, begin with a small Mermaid diagram,
then explain the relevant choices in prose.
```

Run `/reload`, then `/output-style diagrams first`. Both metadata fields are
optional; the filename without `.md` supplies the name by default. Other fields
are ignored. `keep-coding-instructions: false` cannot remove Pi's instructions;
`force-for-plugin` cannot activate a style.

Nearest project styles override ancestor styles, personal styles, then built-ins
by case-insensitive name. Default is reserved. Duplicate names within a directory
use the first lexicographically sorted filename and produce a warning. Styles,
settings, and their directories support symlinks. Symlink targets must have the
expected file or directory type. Broken symlinks produce diagnostics. Discovery
does not recurse into subdirectories.
Invalid YAML falls back to the filename and Markdown body with a warning.
Empty or unreadable files are unavailable. Diagnostics explain repairs.

Project styles and settings load only after Pi grants project trust. The package
does not grant trust. Before trust is granted, only personal defaults and styles
are eligible, and selection commands cannot write project-local settings. Use Pi's
normal trust workflow and `/reload` before selecting a style.

Keep styles separate from Pi's skills, prompt templates, and project context files:
they are session-wide preferences, not task-specific procedures or project guidance.

## Persistence and reload

The package uses its own JSON files, leaving Pi's settings unchanged:

| File                                            | Purpose                       |
| ----------------------------------------------- | ----------------------------- |
| `<agent-directory>/output-styles/settings.json` | Personal default              |
| `.pi/output-styles/settings.json`               | Shared project default        |
| `.pi/output-styles/settings.local.json`         | Local selection from commands |

```json
{
  "outputStyle": "Explanatory"
}
```

Local settings override shared project settings, which override personal defaults.
Within each project setting category, the nearest directory wins. Saved names
must match exactly; commands write the canonical name automatically. Selecting
Default saves an explicit override. Remove `outputStyle` manually and `/reload` to
inherit a lower-priority default again.

Commands save local settings in the session working directory before changing
active state. They preserve unrelated JSON keys and existing symlinks when saving.
Failed saves or invalid existing local JSON leave the active choice unchanged. Exclude
`.pi/output-styles/settings.local.json` from version control using your project's
normal ignore policy; the package does not edit Git configuration.

Startup, resume, session branching/replacement, and `/reload` resolve the current
settings, not a past style stored in conversation history. Custom files and
externally edited settings are snapshots: changes, new files, or deletion take
effect after restart or `/reload`. If the saved style is unavailable on refresh,
Pi uses Default, warns, and retains the saved name so you can repair it. Trust or
working-directory changes rebuild the eligible snapshot; trust loss removes
project-derived style instructions.

## Limits and verification

The extension supports the interactive TUI only. Print, JSON, and RPC modes add no style
instructions, show no UI, and perform no selection writes. Nested model calls and
separately launched Pi processes are outside scope. Styles add input tokens and
may increase response length; they cannot guarantee model compliance or enforce
permissions.

```sh
npm run check --workspace output-styles
npm run check
```

Tests use mocked Pi boundaries and temporary files without calling a provider.
Manual Pi validation is required for loading, switching, persistence, reload,
and useful model-behavior differences.

## Code structure

The entrypoint delegates lifecycle registration to `src/session.ts`. `StyleSelection` owns snapshots, selection, picker validity, and save-before-activation ordering. `src/presentation.ts` formats the status indicator. Catalog discovery, settings persistence, filesystem operations, and prompt composition retain their existing boundaries.
