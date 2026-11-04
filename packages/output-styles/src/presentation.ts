import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Style } from "./styles.js";

export function updateStatus(
	ctx: ExtensionContext,
	active: { selected: Style; requested: string },
): void {
	const unavailable = active.requested !== active.selected.name;
	const theme = ctx.ui.theme;
	ctx.ui.setStatus(
		"output-styles",
		`📝 ${theme.fg("muted", "style: ")}${theme.fg("text", active.selected.name)}` +
			(unavailable
				? theme.fg("muted", ` (${active.requested} unavailable)`)
				: ""),
	);
}
