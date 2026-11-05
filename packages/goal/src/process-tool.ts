import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { GoalController } from "./controller.js";

export function registerProcessTool(
	pi: ExtensionAPI,
	controller: Pick<GoalController, "process">,
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
			const result = await controller.process(args.action, args, signal, c);
			return {
				content: [{ type: "text", text: JSON.stringify(result) }],
				details: {},
			};
		},
	});
}
