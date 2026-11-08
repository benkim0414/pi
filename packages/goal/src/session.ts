import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGoalCommands } from "./commands.js";
import { GoalController } from "./controller.js";
import { registerProcessTool } from "./process-tool.js";

export function registerGoalSession(pi: ExtensionAPI): void {
	const controller = new GoalController(pi);
	pi.on("session_start", (event, context) =>
		controller.startSession(event.reason, context),
	);
	pi.on("session_tree", (_event, context) =>
		controller.navigateSession(context),
	);
	pi.on("session_shutdown", () => controller.dispose());
	pi.on("input", (event, context) => {
		controller.input(event.source, context);
		return { action: "continue" };
	});
	pi.on("agent_settled", (event, context) =>
		controller.settled(event.aborted, context),
	);
	pi.on("agent_before_settle", (event, context) =>
		controller.evaluate(event, context),
	);
	registerGoalCommands(pi, controller);
	registerProcessTool(pi, controller);
}
