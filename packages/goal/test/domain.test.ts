import { describe, expect, it } from "vitest";
import {
	applyVerdict,
	isGoal,
	itemIndex,
	newGoal,
	parseCommand,
	parseContract,
	parseDraftContract,
	parseVerdict,
	pause,
	resume,
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
