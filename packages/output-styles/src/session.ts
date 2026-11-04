import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StyleSelection } from "./selection.js";
import { contributePrompt } from "./styles.js";

export function registerOutputStylesSession(pi: ExtensionAPI): void {
	const selection = new StyleSelection();

	pi.on("session_start", (_event, context) => {
		selection.clear();
		if (context.mode === "tui") selection.initialize(context);
	});

	pi.on("session_shutdown", (_event, context) => {
		selection.clear();
		if (context.mode === "tui")
			context.ui.setStatus("output-styles", undefined);
	});

	pi.on("before_agent_start", (event, context) => {
		if (context.mode !== "tui") return;
		return contributePrompt(
			event.systemPrompt,
			selection.current(context).selected,
		);
	});

	pi.registerCommand("output-style", {
		description:
			"Select an output style; omit the name to inspect styles and the current selection",
		getArgumentCompletions: (prefix) => selection.complete(prefix),
		handler: (args, context) => selection.select(args, context),
	});
}
