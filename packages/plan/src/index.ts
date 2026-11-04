import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildPlanPrompt } from "./prompt.js";

export default function plan(pi: ExtensionAPI): void {
	pi.registerCommand("plan", {
		description: "Write an implementation plan without executing it",
		handler: async (args, ctx) => {
			if (ctx.mode !== "tui") return;
			if (!ctx.isProjectTrusted()) {
				ctx.ui.notify(
					"Trust the project in Pi before running /plan.",
					"warning",
				);
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify(
					"Wait for the current run to finish before running /plan.",
					"warning",
				);
				return;
			}
			try {
				pi.sendUserMessage(buildPlanPrompt(args), {
					expandPromptTemplates: false,
				});
			} catch (error) {
				ctx.ui.notify(
					`Cannot start planning: ${error instanceof Error ? error.message : String(error)}. Retry /plan.`,
					"error",
				);
			}
		},
	});
}
