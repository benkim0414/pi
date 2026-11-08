import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalController } from "./controller.js";
import { parseCommand } from "./domain.js";

export function registerGoalCommands(
	pi: ExtensionAPI,
	controller: GoalController,
): void {
	pi.registerCommand("goal", {
		description: "Maintain an objective across turns",
		handler: async (args, context) => {
			try {
				await controller.execute(parseCommand(args), context);
			} catch (error) {
				context.ui.notify(String(error), "info");
			}
		},
	});
	pi.registerCommand("subgoal", {
		description: "Manage additional goal acceptance criteria",
		handler: async (args, context) => {
			try {
				controller.subgoal(args, context);
			} catch (error) {
				context.ui.notify(String(error), "info");
			}
		},
	});
}
