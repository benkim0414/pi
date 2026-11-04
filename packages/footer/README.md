# Footer

A private Pi 1.5.0 extension that colors and adds icons to existing footer information. It retains two base rows and the optional extension-status row.

Load independently with `pi -e ./packages/footer/src/index.ts` from the workspace root, or load this workspace as a Pi package. The root package registers the extension.

Icons identify directory 📁, branch 🌿, session 🏷️, cost 💰, context 📊, model 🤖, and thinking 🧠. Token and cache labels retain ↑, ↓, R, W, and CH. Theme colors distinguish paths, branches, models, and context warnings above 70% and errors above 90%. Emoji rendering depends on the terminal; Blink.sh over Mosh requires visual verification.

Usage includes all session records, including branches, tools, compactions, and summaries. CH is the latest assistant response's cache-read share of prompt tokens. Zero-valued usage fields are hidden, matching the default visibility rules. Unknown context is shown as `?`.

Public replacement APIs do not expose subscription classification, the effective auto-compaction toggle, experimental-feature state, or routed-model runtime state. Their indicators are omitted. No commands or settings are added; non-TUI modes are unaffected.

Run `npm run check --workspace footer` or `npm run check` from the workspace root.

## Code structure

The entrypoint registers lifecycle callbacks. `src/component.ts` owns the branch subscription and usage cache. `src/usage.ts` aggregates whole-session records and caches by session identity, leaf, and entry count. `src/render.ts` renders a supplied view without reading session state or the filesystem. Token formatting remains re-exported from the entrypoint for compatibility.
