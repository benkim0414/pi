import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GoalController } from "./controller.js";
import { parseCommand } from "./domain.js";

export function registerGoalCommands(
	pi: ExtensionAPI,
	controller: GoalController,
): void {
	pi.registerCommand("goal", {
		description: "Maintain an objective across turns",
		handler: (args, context) => controller.command(parseCommand(args), context),
	});
	pi.registerCommand("subgoal", {
		description: "Manage additional goal acceptance criteria",
		handler: async (args, context) => controller.criteria(args, context),
	});
}
