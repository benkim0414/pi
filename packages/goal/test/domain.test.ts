import { describe, expect, it } from "vitest";
import {
	admitWait,
	applyVerdict,
	BUDGET_EXHAUSTED_REASON,
	clear,
	isGoal,
	itemIndex,
	newGoal,
	parseCommand,
	parseContract,
	parseDraftContract,
	parseVerdict,
	pause,
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
});
