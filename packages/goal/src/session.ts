import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerGoalCommands } from "./commands.js";
import { GoalController } from "./controller.js";
import { registerProcessTool } from "./process-tool.js";

export function registerGoalSession(pi: ExtensionAPI): void {
	const controller = new GoalController(pi);
	pi.on("session_start", (event, c) =>
		controller.startSession(event.reason, c),
	);
	pi.on("session_tree", (_event, c) => controller.navigateSession(c));
	pi.on("session_shutdown", () => controller.dispose());
	pi.on("input", (event, c) => {
		controller.input(event.source, c);
		return { action: "continue" };
	});
	pi.on("agent_settled", (event, c) => controller.settled(event.aborted, c));
	pi.on("agent_before_settle", (event, c) => controller.evaluate(event, c));
	registerGoalCommands(pi, controller);
	registerProcessTool(pi, controller);
}
