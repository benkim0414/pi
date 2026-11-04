import {
	type ExtensionAPI,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { matchesKey } from "@earendil-works/pi-tui";
import { registerGoalCommands } from "./commands.js";
import { loadConfig } from "./config.js";
import { GoalController } from "./controller.js";
import { pause } from "./domain.js";
import { registerGoalEvaluation } from "./evaluation.js";
import { registerProcessTool } from "./process-tool.js";

export function registerGoalSession(pi: ExtensionAPI): void {
	const controller = new GoalController(pi);

	pi.on("session_start", async (event, c) => {
		controller.context = c;
		controller.invalidate();
		controller.goal = undefined;
		controller.unsubscribeInput?.();
		controller.unsubscribeInput = undefined;
		if (!controller.eligible(c)) return;
		controller.unsubscribeInput = c.ui.onTerminalInput((data) => {
			if (controller.goal?.status === "active" && matchesKey(data, "escape")) {
				controller.invalidate();
				pause(controller.goal, "Execution aborted; use /goal resume.");
				controller.save();
				controller.notify(controller.goal.reason);
			}
			return undefined;
		});
		controller.config = await loadConfig(getAgentDir(), c.cwd, (text) =>
			controller.notify(text),
		);
		controller.goal = controller.restore(c);
		if (
			controller.goal &&
			event.reason === "fork" &&
			controller.goal.status === "active"
		)
			pause(controller.goal, "Forked goal; use /goal resume.");
		if (controller.goal?.wait?.kind === "process") {
			controller.goal.wait = undefined;
			controller.goal.reason =
				"Previous process session ended; commands were not restarted.";
		}
		controller.save();
		if (controller.goal?.status === "active") {
			if (controller.goal.wait) controller.scheduleWake();
			else await controller.submit(controller.goal);
		}
	});

	pi.on("session_tree", (_event, c) => {
		controller.context = c;
		controller.invalidate();
		controller.goal = undefined;
		if (!controller.eligible(c)) return;
		controller.goal = controller.restore(c);
		if (controller.goal?.status === "active")
			pause(controller.goal, "Tree navigation; use /goal resume.");
		controller.save();
	});

	pi.on("session_shutdown", async () => {
		await controller.dispose();
	});

	pi.on("input", (event, c) => {
		controller.context = c;
		if (event.source !== "extension") {
			controller.onHumanInput();
		}
		return { action: "continue" };
	});

	pi.on("agent_settled", (event, c) => {
		controller.context = c;
		if (event.aborted && controller.goal?.status === "active") {
			controller.invalidate();
			pause(controller.goal, "Execution aborted; use /goal resume.");
			controller.save();
		}
		if (controller.goal?.wait || controller.wakePending)
			controller.scheduleWake();
	});

	registerGoalCommands(pi, controller);
	registerGoalEvaluation(pi, controller);
	registerProcessTool(pi, controller);
}
