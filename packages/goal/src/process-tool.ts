import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { GoalController } from "./controller.js";

export function registerProcessTool(
	pi: ExtensionAPI,
	controller: Pick<GoalController, "eligible" | "processes">,
): void {
	pi.registerTool({
		name: "goal_process",
		label: "Goal process",
		description:
			"Start and manage session-owned local background commands. Respect repository permissions and approvals. Output patterns are literal strings. Use process IDs returned here for waiting.",
		parameters: Type.Object({
			action: Type.Union(
				["start", "list", "output", "input", "stop"].map((v) =>
					Type.Literal(v),
				),
			),
			command: Type.Optional(Type.String()),
			id: Type.Optional(Type.String()),
			text: Type.Optional(Type.String()),
			patterns: Type.Optional(Type.Array(Type.String())),
		}),
		async execute(_id, args, signal, _update, c) {
			if (!controller.eligible(c))
				throw new Error("Goal processes require a trusted TUI session.");
			let result: unknown;
			switch (args.action) {
				case "start":
					result = await controller.processes.start(
						args.command || "",
						c.cwd,
						args.patterns,
						signal,
					);
					break;
				case "list":
					result = controller.processes.list();
					break;
				case "output":
					result = controller.processes.get(args.id || "");
					break;
				case "input":
					controller.processes.input(args.id || "", args.text || "");
					result = "Input sent";
					break;
				case "stop":
					controller.processes.stop(args.id || "");
					result = "Stop requested";
					break;
				default:
					throw new Error("Unknown process action");
			}
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: {},
			};
		},
	});
}
