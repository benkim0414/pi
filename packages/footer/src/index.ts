import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createFooterFactory } from "./component.js";

export { formatTokens } from "./format.js";

export default function footer(pi: ExtensionAPI): void {
	pi.on("session_start", (_event, context) => {
		if (context.mode !== "tui") return;
		context.ui.setFooter(createFooterFactory(pi, context));
	});

	pi.on("session_shutdown", (_event, context) => {
		if (context.mode === "tui") context.ui.setFooter(undefined);
	});
}
