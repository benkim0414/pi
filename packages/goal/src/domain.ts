export interface Contract {
	outcome?: string;
	verification?: string;
	constraints?: string;
	boundaries?: string;
	stop_when?: string;
}

export interface Gate {
	command: string;
	failures: number;
	code?: number;
	output?: string;
}

export type Wait =
	| { kind: "pid"; pid: number; deadline: number; reason: string }
	| { kind: "process"; id: string; deadline: number; reason: string }
	| { kind: "time"; deadline: number; reason: string };

export interface Goal {
	version: 1;
	revision: number;
	objective: string;
	contract: Contract;
	criteria: string[];
	gates: Gate[];
	status: "active" | "paused" | "done" | "cleared";
	used: number;
	limit: number;
	reason: string;
	parseFailures: number;
	transportFailures: number;
	wait?: Wait;
}

export interface Verdict {
	verdict: "done" | "blocked" | "continue" | "wait";
	reason: string;
	wait_on_pid?: number;
	wait_on_session?: string;
	wait_for_seconds?: number;
}

const fields: Record<string, keyof Contract> = {
	outcome: "outcome",
	verify: "verification",
	verification: "verification",
	"verified by": "verification",
	constraints: "constraints",
	preserve: "constraints",
	boundaries: "boundaries",
	scope: "boundaries",
	"stop when": "stop_when",
	stop_when: "stop_when",
	blocked: "stop_when",
};

export function parseContract(text: string): {
	objective: string;
	contract: Contract;
} {
	const objective: string[] = [];
	const contract: Contract = {};
	for (const line of text.trim().split("\n")) {
		const match = /^\s*([^:]+):\s*(.*)$/.exec(line);
		const key = match && fields[match[1]!.trim().toLowerCase()];
		if (key)
			contract[key] = [contract[key], match![2]!.trim()]
				.filter(Boolean)
				.join("\n");
		else objective.push(line);
	}
	return {
		objective: objective.join("\n").trim() || contract.outcome || text.trim(),
		contract,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseDraftContract(text: string): Contract {
	const value: unknown = JSON.parse(
		text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""),
	);
	if (!isRecord(value)) throw new Error("Invalid contract");
	const contract: Contract = {};
	for (const key of [
		"outcome",
		"verification",
		"constraints",
		"boundaries",
		"stop_when",
	] as const) {
		if (key in value && typeof value[key] === "string")
			contract[key] = value[key];
	}
	return contract;
}

export type CommandAction =
	| "set"
	| "status"
	| "show"
	| "draft"
	| "clear"
	| "pause"
	| "resume"
	| "unwait"
	| "wait"
	| "gate";

export interface Command {
	action: CommandAction;
	argument: string;
	ignored?: string;
}

export function parseCommand(text: string): Command {
	const raw = text.trim();
	if (raw.startsWith("-- "))
		return { action: "set", argument: raw.slice(3).trim() };
	if (!raw) return { action: "status", argument: "" };
	const [word = "", ...rest] = raw.split(/\s+/);
	const verb = word.toLowerCase();
	const argument = raw.slice(word.length).trim();
	const aliases: Record<string, string> = {
		continue: "resume",
		unpause: "resume",
		stop: "clear",
		done: "clear",
	};
	const action = aliases[verb] || verb;
	if (
		action === "resume" ||
		action === "pause" ||
		action === "status" ||
		action === "show" ||
		action === "unwait"
	)
		return {
			action,
			argument: "",
			...(rest.length ? { ignored: argument } : {}),
		};
	if (action === "clear" && !argument) return { action, argument };
	if (action === "draft" || action === "wait" || action === "gate")
		return { action, argument };
	return { action: "set", argument: raw };
}

export function newGoal(text: string, limit = 20, revision = 1): Goal {
	if (!text.trim()) throw new Error("Goal text is empty.");
	return {
		version: 1,
		revision,
		...parseContract(text),
		criteria: [],
		gates: [],
		status: "active",
		used: 0,
		limit,
		reason: "Goal set",
		parseFailures: 0,
		transportFailures: 0,
	};
}

export const BUDGET_EXHAUSTED_REASON =
	"Turn budget exhausted. Use /goal resume or /goal clear.";

export function resume(goal: Goal): Goal {
	goal.status = "active";
	goal.used = 0;
	goal.wait = undefined;
	goal.parseFailures = 0;
	goal.transportFailures = 0;
	for (const gate of goal.gates) gate.failures = 0;
	goal.reason = "Goal resumed";
	goal.revision++;
	return goal;
}

export function pause(goal: Goal, reason: string): Goal {
	goal.status = "paused";
	goal.wait = undefined;
	goal.reason = reason;
	goal.revision++;
	return goal;
}

export function clear(goal: Goal): Goal {
	goal.status = "cleared";
	goal.wait = undefined;
	goal.revision++;
	return goal;
}

export function unwait(goal: Goal): Goal {
	goal.wait = undefined;
	goal.revision++;
	return goal;
}

export function clearCriteria(goal: Goal): Goal {
	goal.criteria = [];
	goal.revision++;
	return goal;
}

export function addCriterion(goal: Goal, text: string): Goal {
	goal.criteria.push(text);
	goal.revision++;
	return goal;
}

export function removeCriterion(goal: Goal, index: number): Goal {
	goal.criteria.splice(index, 1);
	goal.revision++;
	return goal;
}

export function addGate(goal: Goal, command: string): Goal {
	goal.gates.push({ command, failures: 0 });
	goal.revision++;
	return goal;
}

export function removeGate(goal: Goal, index: number): Goal {
	goal.gates.splice(index, 1);
	goal.revision++;
	return goal;
}

export function clearGates(goal: Goal): Goal {
	goal.gates = [];
	goal.revision++;
	return goal;
}

export function applyGateResult(
	goal: Goal,
	gate: Gate,
	output: { code: number; output: string; killed: boolean },
): Goal {
	gate.code = output.code;
	gate.output = output.output;
	if (output.code !== 0 || output.killed) {
		gate.failures++;
		goal.reason = `Gate failed (${gate.failures}/3): ${gate.command}\n${gate.output}`;
		if (gate.failures >= 3) pause(goal, goal.reason);
		return goal;
	}
	gate.failures = 0;
	return goal;
}

export function recordTransportSuccess(goal: Goal): Goal {
	goal.transportFailures = 0;
	return goal;
}

export function recordTransportFailure(goal: Goal, error: string): Verdict {
	goal.transportFailures++;
	if (goal.transportFailures >= 5)
		pause(goal, "Repeated judge transport failures. Check goal.json.");
	return {
		verdict: "continue",
		reason: `Judge unavailable: ${error}`,
	};
}

export function recordParseSuccess(goal: Goal): Goal {
	goal.parseFailures = 0;
	return goal;
}

export function recordParseFailure(goal: Goal): Verdict {
	goal.parseFailures++;
	if (goal.parseFailures >= 3)
		pause(goal, "Repeated malformed judge replies. Check goal.json.");
	return {
		verdict: "continue",
		reason: "Judge response could not be parsed.",
	};
}

export function waitOnPid(
	goal: Goal,
	pid: number,
	reason: string,
	now: number,
): Goal {
	goal.wait = {
		kind: "pid",
		pid,
		reason,
		deadline: now + 1_800_000,
	};
	goal.revision++;
	return goal;
}

export interface WaitHoldFacts {
	now: number;
	pidAlive: boolean;
	processHeld: boolean;
}

export function releaseExpiredWait(goal: Goal, facts: WaitHoldFacts): Goal {
	const wait = goal.wait;
	if (!wait) return goal;
	let held = facts.now < wait.deadline;
	if (wait.kind === "pid") held = held && facts.pidAlive;
	if (wait.kind === "process") held = held && facts.processHeld;
	if (held) return goal;
	goal.wait = undefined;
	goal.revision++;
	return goal;
}

export interface WaitAdmissionFacts {
	now: number;
	pidAlive: boolean;
	processHeld: boolean;
}

export function admitWait(
	goal: Goal,
	result: Verdict,
	facts: WaitAdmissionFacts,
): Goal {
	if (result.verdict !== "wait" || goal.status !== "active") return goal;
	const ceiling = facts.now + 1_800_000;
	if (result.wait_on_session && facts.processHeld) {
		goal.wait = {
			kind: "process",
			id: result.wait_on_session,
			deadline: ceiling,
			reason: result.reason,
		};
		return goal;
	}
	if (
		result.wait_on_pid &&
		Number.isSafeInteger(result.wait_on_pid) &&
		result.wait_on_pid > 0 &&
		facts.pidAlive
	) {
		goal.wait = {
			kind: "pid",
			pid: result.wait_on_pid,
			deadline: ceiling,
			reason: result.reason,
		};
		return goal;
	}
	if (
		result.wait_for_seconds &&
		Number.isSafeInteger(result.wait_for_seconds) &&
		result.wait_for_seconds > 0 &&
		result.wait_for_seconds <= 2147483
	) {
		goal.wait = {
			kind: "time",
			deadline: facts.now + result.wait_for_seconds * 1000,
			reason: result.reason,
		};
		return goal;
	}
	return pause(
		goal,
		`Cannot wait: no live target or cooldown is available. ${result.reason} Use /goal resume to continue.`,
	);
}

export function clearRestoredProcessWait(goal: Goal): Goal {
	if (goal.wait?.kind !== "process") return goal;
	goal.wait = undefined;
	goal.reason = "Previous process session ended; commands were not restarted.";
	return goal;
}

export function itemIndex(text: string, length: number): number {
	if (!/^[1-9]\d*$/.test(text) || Number(text) > length)
		throw new Error(`Index must be between 1 and ${length}.`);
	return Number(text) - 1;
}

export function parseVerdict(text: string): Verdict {
	const value = JSON.parse(
		text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""),
	);
	if (!value || typeof value !== "object")
		throw new Error("Invalid judge response");
	if (typeof value.done === "boolean" && !value.verdict)
		value.verdict = value.done ? "done" : "continue";
	if (
		!["done", "blocked", "continue", "wait"].includes(value.verdict) ||
		typeof value.reason !== "string"
	)
		throw new Error("Invalid judge verdict");
	if (
		value.verdict === "wait" &&
		!(
			(Number.isSafeInteger(value.wait_on_pid) && value.wait_on_pid > 0) ||
			(typeof value.wait_on_session === "string" &&
				value.wait_on_session.length > 0) ||
			(Number.isSafeInteger(value.wait_for_seconds) &&
				value.wait_for_seconds > 0 &&
				value.wait_for_seconds <= 2147483)
		)
	)
		throw new Error("Invalid wait directive");
	return value as Verdict;
}

export function applyVerdict(goal: Goal, result: Verdict): Goal {
	goal.reason = result.reason;
	if (result.verdict === "done") {
		goal.status = "done";
		goal.wait = undefined;
	} else if (result.verdict === "blocked") pause(goal, result.reason);
	else if (goal.used >= goal.limit) pause(goal, BUDGET_EXHAUSTED_REASON);
	return goal;
}

export function continuation(goal: Goal): string {
	return `[Continuing toward your standing goal]\n${goal.objective}\nCompletion contract: ${JSON.stringify(goal.contract)}\nAdditional criteria: ${JSON.stringify(goal.criteria)}\nLatest result: ${goal.reason}\nTake the next concrete authorized step. Respect repository guidance and approvals. Show concrete verification evidence before declaring completion. If blocked or input is required, explain and stop.`;
}

export function isGoal(value: unknown): value is Goal {
	if (!value || typeof value !== "object") return false;
	const g = value as Goal;
	const wait = g.wait;
	if (
		wait &&
		(!Number.isFinite(wait.deadline) ||
			typeof wait.reason !== "string" ||
			!(
				wait.kind === "time" ||
				(wait.kind === "pid" &&
					Number.isSafeInteger(wait.pid) &&
					wait.pid > 0) ||
				(wait.kind === "process" &&
					typeof wait.id === "string" &&
					wait.id.length > 0)
			))
	)
		return false;
	return (
		g.version === 1 &&
		typeof g.objective === "string" &&
		["active", "paused", "done", "cleared"].includes(g.status) &&
		Number.isSafeInteger(g.revision) &&
		Number.isSafeInteger(g.used) &&
		g.used >= 0 &&
		Number.isSafeInteger(g.limit) &&
		g.limit > 0 &&
		typeof g.reason === "string" &&
		Number.isSafeInteger(g.parseFailures) &&
		Number.isSafeInteger(g.transportFailures) &&
		!!g.contract &&
		typeof g.contract === "object" &&
		Object.values(g.contract).every((v) => typeof v === "string") &&
		Array.isArray(g.criteria) &&
		g.criteria.every((v) => typeof v === "string") &&
		Array.isArray(g.gates) &&
		g.gates.every(
			(v) =>
				!!v &&
				typeof v === "object" &&
				typeof v.command === "string" &&
				Number.isSafeInteger(v.failures),
		)
	);
}
