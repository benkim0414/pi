import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { requestAuxiliary } from "./auxiliary.js";
import type { GoalController } from "./controller.js";
import {
	type Command,
	type CommandAction,
	type Goal,
	itemIndex,
	newGoal,
	parseCommand,
	parseDraftContract,
	pause,
	resume,
} from "./domain.js";
import { pidAlive } from "./processes.js";

export function registerGoalCommands(
	pi: ExtensionAPI,
	controller: GoalController,
): void {
	pi.registerCommand("goal", {
		description: "Maintain an objective across turns",
		handler: async (args, context) => {
			controller.context = context;
			if (!controller.eligible(context)) {
				if (context.mode === "tui")
					controller.notify("Trust the project before running /goal.");
				return;
			}
			try {
				const command = parseCommand(args);
				if (command.ignored)
					controller.notify(
						`Ignored trailing text: ${command.ignored}. Use /goal -- <text> for a literal objective.`,
					);
				await executeGoalCommand(controller, context, command);
			} catch (error) {
				controller.notify(String(error));
			}
		},
	});
	pi.registerCommand("subgoal", {
		description: "Manage additional goal acceptance criteria",
		handler: async (args, context) => {
			controller.context = context;
			if (!controller.eligible(context)) return;
			try {
				const goal = controller.requireGoal();
				const text = args.trim();
				if (!text) {
					controller.notify(JSON.stringify(goal.criteria));
					return;
				}
				if (text === "clear") goal.criteria = [];
				else if (text.startsWith("remove "))
					goal.criteria.splice(
						itemIndex(text.slice(7).trim(), goal.criteria.length),
						1,
					);
				else goal.criteria.push(text);
				controller.invalidate();
				goal.revision++;
				controller.wakePending = goal.status === "active" && !context.isIdle();
				controller.save();
				controller.scheduleWake();
			} catch (error) {
				controller.notify(String(error));
			}
		},
	});
}

async function startGoal(
	controller: GoalController,
	context: ExtensionContext,
	argument: string,
	draft: boolean,
): Promise<void> {
	if (!context.isIdle())
		throw new Error(
			"Wait for the current run to finish or abort it before replacing a goal.",
		);
	if (!argument) throw new Error("Provide an objective.");
	controller.invalidate();
	const inputIsCurrent = controller.captureInput();
	const next = newGoal(
		argument,
		controller.config.maxTurns,
		(controller.goal?.revision || 0) + 1,
	);
	let draftFailed = false;
	if (draft) {
		const abort = new AbortController();
		controller.pending = abort;
		const timeout = setTimeout(() => abort.abort(), 30000);
		try {
			const text = await requestAuxiliary(
				context,
				controller.config,
				"Return only a JSON completion contract with optional string fields outcome, verification, constraints, boundaries, stop_when. Make verification concrete. Do not add executable commands or permissions beyond the objective.",
				argument,
				abort.signal,
			);
			Object.assign(next.contract, parseDraftContract(text));
		} catch {
			draftFailed = true;
		} finally {
			clearTimeout(timeout);
			controller.pending = undefined;
		}
	}
	if (!inputIsCurrent()) return;
	controller.goal = next;
	if (draftFailed)
		controller.notify(
			"Could not draft a contract; starting the free-form objective.",
		);
	controller.save();
	controller.notify(
		`Goal set (${controller.goal.limit} turns): ${controller.goal.objective}\n${JSON.stringify(controller.goal.contract)}`,
	);
	try {
		await controller.submit(controller.goal);
	} catch (error) {
		pause(controller.goal, `Submission failed: ${String(error)}`);
		controller.save();
	}
}

function showGoal(controller: GoalController, action: CommandAction): void {
	controller.notify(
		controller.goal && controller.goal.status !== "cleared"
			? JSON.stringify(
					action === "show"
						? controller.goal
						: {
								objective: controller.goal.objective,
								status: controller.goal.status,
								used: controller.goal.used,
								limit: controller.goal.limit,
								reason: controller.goal.reason,
								wait: controller.goal.wait,
							},
					null,
					2,
				)
			: "No goal set.",
	);
}

function waitForPid(
	controller: GoalController,
	goal: Goal,
	argument: string,
): void {
	const match = /^([1-9]\d*)(?:\s+(.*))?$/.exec(argument);
	if (
		!match ||
		!Number.isSafeInteger(Number(match[1])) ||
		!pidAlive(Number(match[1]))
	)
		throw new Error("Provide a live local PID.");
	if (goal.status !== "active")
		throw new Error("Resume the goal before waiting.");
	controller.invalidate();
	goal.wait = {
		kind: "pid",
		pid: Number(match[1]),
		reason: match[2] || "Process exit",
		deadline: Date.now() + 1800000,
	};
	goal.revision++;
	controller.save();
	controller.scheduleWake();
}

function updateGates(
	controller: GoalController,
	context: ExtensionContext,
	goal: Goal,
	argument: string,
): void {
	const [verb = "", ...parts] = argument.split(/\s+/);
	const rest = parts.join(" ");
	if (!verb || verb === "list") {
		controller.notify(JSON.stringify(goal.gates, null, 2));
		return;
	}
	if (verb === "add" && !rest) throw new Error("Provide a gate command.");
	if (verb === "add") goal.gates.push({ command: rest, failures: 0 });
	else if (verb === "remove" || verb === "rm")
		goal.gates.splice(itemIndex(rest, goal.gates.length), 1);
	else if (verb === "clear" && !rest) goal.gates = [];
	else
		throw new Error("Usage: /goal gate [list|add <command>|remove <N>|clear]");
	controller.invalidate();
	goal.revision++;
	controller.wakePending = goal.status === "active" && !context.isIdle();
	controller.save();
	controller.scheduleWake();
}

async function controlGoal(
	controller: GoalController,
	context: ExtensionContext,
	action: CommandAction,
): Promise<void> {
	if (action === "clear") {
		controller.invalidate();
		if (controller.goal) {
			controller.goal.status = "cleared";
			controller.goal.wait = undefined;
			controller.goal.revision++;
			controller.save();
		}
		controller.notify("Goal cleared.");
		return;
	}
	const goal = controller.requireGoal();
	if (action === "pause") {
		controller.invalidate();
		pause(goal, "User paused");
		controller.save();
		return;
	}
	if (action === "resume") {
		controller.invalidate();
		resume(goal);
		controller.save();
		if (context.isIdle()) await controller.submit(goal);
		else controller.wakePending = true;
		return;
	}
	if (action === "unwait") {
		controller.invalidate();
		goal.wait = undefined;
		goal.revision++;
		controller.save();
		if (goal.status === "active" && context.isIdle())
			await controller.submit(goal);
		return;
	}
}

async function executeGoalCommand(
	controller: GoalController,
	context: ExtensionContext,
	command: Command,
): Promise<void> {
	const { action, argument } = command;
	if (action === "status" || action === "show") {
		showGoal(controller, action);
		return;
	}
	if (action === "set" || action === "draft") {
		await startGoal(controller, context, argument, action === "draft");
		return;
	}

	if (["clear", "pause", "resume", "unwait"].includes(action)) {
		await controlGoal(controller, context, action);
		return;
	}
	const goal = controller.requireGoal();
	if (action === "wait") {
		waitForPid(controller, goal, argument);
		return;
	}
	if (action === "gate") {
		updateGates(controller, context, goal, argument);
		return;
	}
}
