# Select an output style

Users inspect available communication styles and select one for subsequent agent runs. The footer shows the effective style, and a project-local settings file records the choice.

## Sub-features

- `style-picker` lists built-in styles and the current choice.
- `style-select-named` selects a style by name.
- `style-persist` writes `.pi/output-styles/settings.local.json` in the workdir.

## How to get to it (user POV)

- Run `/output-style` to open the picker.
- Run `/output-style <name>` (for example `concise`).
- Escape cancels the picker without changing the selection.

## Driving it with control-pi

Preconditions:

- Instance launched with the default disposable workdir (not `/workspace`) so settings stay isolated.
- `control-pi doctor` exits 0.
- Footer shows `style: Default` (or note the starting name).

- **Open picker.** Run `control-pi send -- '/output-style'`. Wait ~1s. Snapshot `style-picker`. Pane lists built-ins including `Default`, `Concise`, and navigation help (`escape`/`enter`).
- **Cancel picker.** Run `control-pi keys -- Escape`. Wait ~0.5s. Snapshot `style-picker-cancel`. Footer style name is unchanged.
- **Named select.** Run `control-pi send -- '/output-style concise'`. Wait ~1s. Snapshot `style-select`. Pane reports the Concise selection; footer shows `style: Concise`.
- **Persist.** Read `$(control-pi env | sed -n 's/^WORKDIR=//p')/.pi/output-styles/settings.local.json` and confirm it names Concise/`concise`. Copy that file into the evidence dir as `settings.local.json`.
- **Proof.** Snapshots plus the copied settings file.

## Gotchas

- Selection applies on the next agent run; footer status updates immediately.
- Unknown names leave the selection unchanged — assert that explicitly if testing errors.
- Saving requires project trust when Pi would prompt; disposable empty workdirs used here typically allow the local save path used in smoke runs. If save is blocked, report the trust message and stop.
