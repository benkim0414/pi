import { describe, expect, it } from "vitest";
import {
	admitWait,
	applyDraftContract,
	applyGateResult,
	applyVerdict,
	BUDGET_EXHAUSTED_REASON,
	clear,
	consumeTurn,
	isGoal,
	itemIndex,
	newGoal,
	parseCommand,
	parseContract,
	parseDraftContract,
	parseGate,
	parseSubgoal,
	parseVerdict,
	parseWaitPid,
	pause,
	recordParseFailure,
	recordTransportFailure,
	releaseExpiredWait,
	resume,
	unwait,
} from "../src/domain.js";

describe("goal contract", () => {
	it("preserves incidental colons and collects criteria", () => {
		const input = "Fix bug: commas\nverify: tests\npreserve: API";

		const contract = parseContract(input);

		expect(contract).toEqual({
			objective: "Fix bug: commas",
			contract: { verification: "tests", constraints: "API" },
		});
	});

	it.each([
		["resume last task", "resume"],
		["drafting docs", "set"],
		["-- pause jobs", "set"],
		["stop jobs", "set"],
		["done", "clear"],
		["continue", "resume"],
	])("parses %s", (input, action) => {
		const command = parseCommand(input);

		expect(command.action).toBe(action);
	});

	it.each(["0", "-1", "1x", "3"])("rejects invalid index %s", (input) => {
		const length = 2;

		expect(() => itemIndex(input, length)).toThrow();
	});

	it.each([
		["", { action: "list" }],
		["clear", { action: "clear" }],
		["remove 1", { action: "remove", index: 0 }],
		["ship it", { action: "add", text: "ship it" }],
	] as const)("parses subgoal %j", (input, expected) => {
		expect(parseSubgoal(input, 2)).toEqual(expected);
	});

	it.each([
		["", { action: "list" }],
		["list", { action: "list" }],
		["add npm test", { action: "add", command: "npm test" }],
		["rm 1", { action: "remove", index: 0 }],
		["clear", { action: "clear" }],
	] as const)("parses gate %j", (input, expected) => {
		expect(parseGate(input, 2)).toEqual(expected);
	});

	it("parses a wait pid and reason", () => {
		expect(parseWaitPid("1234 cooling")).toEqual({
			pid: 1234,
			reason: "cooling",
		});
	});

	it("rejects a non-positive wait pid", () => {
		expect(() => parseWaitPid("0")).toThrow(/live local PID/);
	});

	it.each([
		["continue", "paused"],
		["done", "done"],
	] as const)("applies %s at the turn budget", (verdict, status) => {
		const goal = newGoal("fix", 1);
		goal.used = 1;

		applyVerdict(goal, { verdict, reason: "verified" });

		expect(goal.status).toBe(status);
		if (status === "paused") expect(goal.reason).toBe(BUDGET_EXHAUSTED_REASON);
	});

	it("resets failures and waiting on resume", () => {
		const goal = newGoal("fix");
		goal.gates.push({ command: "false", failures: 3 });
		goal.parseFailures = 3;
		pause(goal, "blocked");

		resume(goal);

		expect([goal.used, goal.parseFailures, goal.gates[0]!.failures]).toEqual([
			0, 0, 0,
		]);
		expect(goal.status).toBe("active");
	});

	it("clears status and wait in one revision bump", () => {
		const goal = newGoal("fix");
		goal.wait = {
			kind: "time",
			deadline: Date.now() + 1000,
			reason: "cooldown",
		};
		const revision = goal.revision;

		clear(goal);

		expect(goal).toMatchObject({
			status: "cleared",
			wait: undefined,
			revision: revision + 1,
		});
	});

	it("releases a wait without changing status", () => {
		const goal = newGoal("fix");
		goal.wait = {
			kind: "pid",
			pid: 1,
			deadline: Date.now() + 1000,
			reason: "exit",
		};
		const revision = goal.revision;

		unwait(goal);

		expect(goal).toMatchObject({
			status: "active",
			wait: undefined,
			revision: revision + 1,
		});
	});

	it("releases an expired wait with the same revision bump as unwait", () => {
		const goal = newGoal("fix");
		goal.wait = {
			kind: "time",
			deadline: 10,
			reason: "cooldown",
		};
		const revision = goal.revision;

		releaseExpiredWait(goal, {
			now: 11,
			pidAlive: false,
			processHeld: false,
		});

		expect(goal).toMatchObject({
			status: "active",
			wait: undefined,
			revision: revision + 1,
		});
	});

	it("keeps a held wait without bumping revision", () => {
		const goal = newGoal("fix");
		goal.wait = {
			kind: "pid",
			pid: 7,
			deadline: 100,
			reason: "exit",
		};
		const revision = goal.revision;

		releaseExpiredWait(goal, {
			now: 50,
			pidAlive: true,
			processHeld: false,
		});

		expect(goal.wait?.kind).toBe("pid");
		expect(goal.revision).toBe(revision);
	});

	it("pauses when wait admission has no usable target", () => {
		const goal = newGoal("fix");
		goal.used = 1;
		const revision = goal.revision;
		applyVerdict(goal, {
			verdict: "wait",
			reason: "awaiting evidence",
			wait_on_session: "missing",
		});

		admitWait(
			goal,
			{
				verdict: "wait",
				reason: "awaiting evidence",
				wait_on_session: "missing",
			},
			{ now: 0, pidAlive: false, processHeld: false },
		);

		expect(goal).toMatchObject({
			status: "paused",
			wait: undefined,
			revision: revision + 1,
		});
		expect(goal.reason).toContain("Cannot wait:");
		expect(goal.reason).toContain("awaiting evidence");
	});

	it("admits a timed wait when live targets are absent", () => {
		const goal = newGoal("fix");
		applyVerdict(goal, {
			verdict: "wait",
			reason: "cooldown",
			wait_for_seconds: 2,
		});

		admitWait(
			goal,
			{
				verdict: "wait",
				reason: "cooldown",
				wait_for_seconds: 2,
			},
			{ now: 1000, pidAlive: false, processHeld: false },
		);

		expect(goal).toMatchObject({
			status: "active",
			wait: { kind: "time", deadline: 3000, reason: "cooldown" },
		});
	});

	it("accepts legacy verdicts", () => {
		const input = '{"done":true,"reason":"verified"}';

		const result = parseVerdict(input);

		expect(result.verdict).toBe("done");
	});

	it("rejects unsafe waits", () => {
		const input = '{"verdict":"wait","reason":"later","wait_on_pid":-1}';

		expect(() => parseVerdict(input)).toThrow();
	});

	it.each([
		[newGoal("x"), true],
		[{ version: 1 }, false],
	])("validates stored snapshot %j", (snapshot, expected) => {
		const valid = isGoal(snapshot);

		expect(valid).toBe(expected);
	});
});

describe("draft contract parsing", () => {
	it("keeps only string contract fields from fenced JSON", () => {
		const input =
			'```json\n{"outcome":"fixed","verification":42,"constraints":"API","gates":["rm -rf ."]}\n```';

		const contract = parseDraftContract(input);

		expect(contract).toEqual({ outcome: "fixed", constraints: "API" });
	});

	it.each(["null", "[]", "42", '"contract"', "not JSON"])(
		"rejects malformed contract %s",
		(text) => {
			expect(() => parseDraftContract(text)).toThrow();
		},
	);

	it("overlays a drafted contract onto a new Goal", () => {
		const goal = newGoal("fix the parser");

		applyDraftContract(goal, {
			verification: "tests pass",
			constraints: "API",
		});

		expect(goal.contract).toEqual({
			verification: "tests pass",
			constraints: "API",
		});
	});
});

describe("evaluation effects", () => {
	it("consumes a turn or pauses when the budget is already spent", () => {
		const active = newGoal("fix", 2);
		expect(consumeTurn(active)).toEqual({ kind: "ok" });
		expect(active.used).toBe(1);

		const spent = newGoal("fix", 1);
		spent.used = 1;
		expect(consumeTurn(spent)).toEqual({
			kind: "paused",
			reason: BUDGET_EXHAUSTED_REASON,
		});
		expect(spent.status).toBe("paused");
		expect(spent.used).toBe(1);
	});

	it("reports a gate pause instead of a continue verdict", () => {
		const goal = newGoal("fix");
		const gate = { command: "false", failures: 2 };

		const effect = applyGateResult(goal, gate, {
			code: 1,
			output: "boom",
			killed: false,
		});

		expect(effect).toEqual({ kind: "paused", reason: goal.reason });
		expect(goal.status).toBe("paused");
		expect(gate.failures).toBe(3);
	});

	it("reports a continue effect for a gate failure under the threshold", () => {
		const goal = newGoal("fix");
		const gate = { command: "false", failures: 0 };

		const effect = applyGateResult(goal, gate, {
			code: 1,
			output: "boom",
			killed: false,
		});

		expect(effect.kind).toBe("continue");
		expect(goal.status).toBe("active");
		expect(gate.failures).toBe(1);
	});

	it("pauses after three malformed judge replies without a continue verdict", () => {
		const goal = newGoal("fix");
		goal.parseFailures = 2;

		const effect = recordParseFailure(goal);

		expect(effect).toEqual({ kind: "paused", reason: goal.reason });
		expect(goal.status).toBe("paused");
		expect(goal.reason).toContain("malformed judge");
	});

	it("returns continue for transport failures under the threshold", () => {
		const goal = newGoal("fix");

		const effect = recordTransportFailure(goal, "timeout");

		expect(effect).toEqual({
			kind: "continue",
			reason: "Judge unavailable: timeout",
		});
		expect(goal.status).toBe("active");
	});
});
