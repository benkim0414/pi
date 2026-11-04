import { describe, expect, it, vi } from "vitest";
import { runGate } from "../src/gates.js";
import { Processes } from "../src/processes.js";

vi.mock("../src/gates.js", () => ({ runGate: vi.fn() }));

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import extension from "../src/index.js";

function fixture(verdicts: unknown[] = []) {
	const events = new Map<string, (...args: any[]) => any>();
	const commands = new Map<string, (...args: any[]) => any>();
	const entries: any[] = [];
	const complete = vi.fn(async () => {
		const v = verdicts.shift();
		if (v instanceof Error) throw v;
		return {
			stopReason: "stop",
			content: [
				{
					type: "text",
					text:
						typeof v === "string"
							? v
							: JSON.stringify(v || { verdict: "done", reason: "verified" }),
				},
			],
		};
	});
	const pi = {
		on: vi.fn((name, handler) => events.set(name, handler)),
		registerCommand: vi.fn((name, def) => commands.set(name, def.handler)),
		registerTool: vi.fn(),
		appendEntry: vi.fn((customType, data) =>
			entries.push({ type: "custom", customType, data }),
		),
		sendUserMessage: vi.fn(),
		exec: vi.fn(async () => ({
			stdout: "pass",
			stderr: "",
			code: 0,
			killed: false,
		})),
	};
	const ctx: any = {
		mode: "tui",
		cwd: "/tmp",
		isProjectTrusted: () => true,
		isIdle: () => true,
		hasPendingMessages: () => false,
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
			onTerminalInput: vi.fn(() => vi.fn()),
		},
		model: { id: "fake" },
		modelRegistry: { complete },
		sessionManager: { getBranch: () => entries },
	};

	vi.mocked(runGate).mockImplementation(async () => {
		const r = await pi.exec();
		return {
			code: r.code,
			output: `${r.stdout}\n${r.stderr}`,
			killed: r.killed,
		};
	});

	ctx.modelRegistry.streamSimple = (...args: any[]) => ({
		result: () => (complete as (...args: any[]) => any)(...args),
	});
	extension(pi as unknown as ExtensionAPI);

	const boundary = () => ({
		outcome: "completed",
		continue: false,
		entries: [],
		context: {
			contextMessages: [
				{
					role: "assistant",
					content: [{ type: "text", text: "Verified tests pass." }],
				},
			],
		},
	});

	return {
		pi,
		ctx,
		events,
		commands,
		entries,
		complete,
		run: (text: string) => commands.get("goal")!(text, ctx),
		evaluate: () => events.get("agent_before_settle")!(boundary(), ctx),
		state: () => entries.at(-1)?.data,
	};
}

describe("goal integration", () => {
	it("starts once and continues until judged complete", async () => {
		const scenario = fixture([
			{ verdict: "continue", reason: "more" },
			{ verdict: "done", reason: "verified" },
		]);

		await scenario.run("fix");

		const continuation = await scenario.evaluate();
		const usedAfterContinuation = scenario.state().used;
		const completion = await scenario.evaluate();

		expect(scenario.pi.sendUserMessage).toHaveBeenCalledTimes(1);
		expect(continuation.continue).toBe(true);
		expect(usedAfterContinuation).toBe(1);
		expect(completion).toBeUndefined();
		expect(scenario.state().status).toBe("done");
	});

	it("runs gates before judging and pauses after three failed attempts", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		await scenario.run("gate add false");
		scenario.pi.exec.mockResolvedValue({
			code: 1,
			stdout: "failed",
			stderr: "",
			killed: false,
		});

		await scenario.evaluate();
		await scenario.evaluate();
		await scenario.evaluate();

		expect(scenario.complete).not.toHaveBeenCalled();
		expect(scenario.state().status).toBe("paused");
		expect(scenario.state().gates[0].failures).toBe(3);
	});

	it("does not revive a paused goal from an outstanding judge", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		let release!: (value: any) => void;

		scenario.complete.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);

		const work = scenario.evaluate();

		await Promise.resolve();
		await scenario.run("pause");
		release({
			stopReason: "stop",
			content: [
				{ type: "text", text: '{"verdict":"continue","reason":"more"}' },
			],
		});

		expect(await work).toBeUndefined();
		expect(scenario.state().status).toBe("paused");
	});

	it("pauses malformed judging and resets on resume", async () => {
		const scenario = fixture(["bad", "bad", "bad"]);

		await scenario.run("fix");
		await scenario.evaluate();
		await scenario.evaluate();
		await scenario.evaluate();

		expect(scenario.state().status).toBe("paused");

		await scenario.run("resume");

		expect(scenario.state().parseFailures).toBe(0);
	});

	it("lets human input invalidate outstanding decisions", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		let release!: (value: any) => void;

		scenario.complete.mockImplementationOnce(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);

		const work = scenario.evaluate();

		await Promise.resolve();
		scenario.events.get("input")!({ source: "interactive" }, scenario.ctx);
		release({
			stopReason: "stop",
			content: [{ type: "text", text: '{"verdict":"done","reason":"old"}' }],
		});

		await work;

		expect(scenario.state().status).toBe("active");
	});

	it("rejects untrusted and non-TUI execution", async () => {
		const scenario = fixture();
		scenario.ctx.mode = "rpc";

		await scenario.run("fix");
		scenario.ctx.mode = "tui";
		scenario.ctx.isProjectTrusted = () => false;

		await scenario.run("fix");

		expect(scenario.pi.sendUserMessage).not.toHaveBeenCalled();
		expect(scenario.entries).toHaveLength(0);
	});

	it("clears state durably and leaves later turns alone", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		await scenario.run("clear");
		await scenario.evaluate();

		expect(scenario.state().status).toBe("cleared");
		expect(scenario.complete).not.toHaveBeenCalled();
	});

	it("pauses on escape", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		await scenario.events.get("agent_settled")!(
			{ aborted: true },
			scenario.ctx,
		);

		expect(scenario.state().status).toBe("paused");
	});

	it("rejects replacement while busy but accepts pause", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		scenario.ctx.isIdle = () => false;

		await scenario.run("other");

		expect(scenario.state().objective).toBe("fix");

		await scenario.run("pause");

		expect(scenario.state().status).toBe("paused");
	});
});

describe("evaluation ownership", () => {
	it("discards an evaluation invalidated before judging starts", async () => {
		const scenario = fixture();

		await scenario.run("fix");

		const evaluation = scenario.evaluate();
		scenario.events.get("input")!({ source: "interactive" }, scenario.ctx);
		const result = await evaluation;

		expect(result).toBeUndefined();
		expect(scenario.complete).not.toHaveBeenCalled();
		expect(scenario.state().status).toBe("active");
	});

	it("judges after a successful gate", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		await scenario.run("gate add true");

		const result = await scenario.evaluate();

		expect(result).toBeUndefined();
		expect(scenario.pi.exec).toHaveBeenCalledOnce();
		expect(scenario.complete).toHaveBeenCalledOnce();
		expect(scenario.state().status).toBe("done");
		expect(scenario.state().gates[0].failures).toBe(0);
	});
});

describe("goal restoration and waiting", () => {
	it("restores paused state without starting work", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		await scenario.run("pause");
		scenario.pi.sendUserMessage.mockClear();

		await scenario.events.get("session_start")!(
			{ reason: "resume" },
			scenario.ctx,
		);

		expect(scenario.state().status).toBe("paused");
		expect(scenario.pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("pauses active goals on forks and tree navigation", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		await scenario.events.get("session_start")!(
			{ reason: "fork" },
			scenario.ctx,
		);

		expect(scenario.state().status).toBe("paused");

		await scenario.run("resume");
		await scenario.events.get("session_tree")!({}, scenario.ctx);

		expect(scenario.state().status).toBe("paused");
	});

	it("prevents resurrection from cleared tombstones", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		await scenario.run("clear");
		scenario.pi.sendUserMessage.mockClear();

		await scenario.events.get("session_start")!(
			{ reason: "resume" },
			scenario.ctx,
		);

		expect(scenario.state().status).toBe("cleared");
		expect(scenario.pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("disables automatic work for invalid snapshots", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		scenario.entries.push({
			type: "custom",
			customType: "goal-state",
			data: { version: 1 },
		});
		scenario.pi.sendUserMessage.mockClear();

		await scenario.events.get("session_start")!(
			{ reason: "reload" },
			scenario.ctx,
		);

		expect(scenario.pi.sendUserMessage).not.toHaveBeenCalled();
	});

	it("waits without consuming evaluations and wakes once", async () => {
		vi.useFakeTimers();
		const scenario = fixture([
			{ verdict: "wait", reason: "cooldown", wait_for_seconds: 2 },
		]);
		try {
			await scenario.run("fix");
			await scenario.evaluate();
			const calls = scenario.complete.mock.calls.length;

			await scenario.evaluate();

			expect(scenario.complete).toHaveBeenCalledTimes(calls);

			await vi.advanceTimersByTimeAsync(2000);

			expect(scenario.pi.sendUserMessage).toHaveBeenCalledTimes(2);
			expect(scenario.state().used).toBe(1);
		} finally {
			await scenario.events.get("session_shutdown")!({}, scenario.ctx);
			vi.useRealTimers();
		}
	});

	it("cancels wait timers on clear", async () => {
		vi.useFakeTimers();
		const scenario = fixture([
			{ verdict: "wait", reason: "cooldown", wait_for_seconds: 2 },
		]);
		try {
			await scenario.run("fix");
			await scenario.evaluate();
			await scenario.run("clear");
			await vi.advanceTimersByTimeAsync(3000);

			expect(scenario.pi.sendUserMessage).toHaveBeenCalledTimes(1);
		} finally {
			await scenario.events.get("session_shutdown")!({}, scenario.ctx);
			vi.useRealTimers();
		}
	});

	it("releases stale process barriers without restarting commands", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		scenario.entries.at(-1).data.wait = {
			kind: "process",
			id: "gone",
			deadline: Date.now() + 1000,
			reason: "old",
		};

		await scenario.events.get("session_start")!(
			{ reason: "resume" },
			scenario.ctx,
		);

		expect(scenario.state().wait).toBeUndefined();
		expect(scenario.pi.exec).not.toHaveBeenCalled();
	});

	it("pauses five consecutive transport failures", async () => {
		const scenario = fixture(
			Array.from({ length: 5 }, () => new Error("offline")),
		);

		await scenario.run("fix");
		for (let n = 0; n < 5; n++) await scenario.evaluate();

		expect(scenario.state().status).toBe("paused");
	});

	it("never creates a gate from a drafted contract", async () => {
		const scenario = fixture(['{"verification":"run tests"}']);

		await scenario.run("draft fix");

		expect(scenario.state().contract.verification).toBe("run tests");
		expect(scenario.state().gates).toEqual([]);
	});
});

describe("review regressions", () => {
	it("does not commit continuation or count transport failure when Escape aborts judging", async () => {
		const scenario = fixture();
		const abort = new AbortController();
		scenario.ctx.signal = abort.signal;

		await scenario.run("fix");

		scenario.complete.mockImplementationOnce(async () => {
			abort.abort();
			throw new Error("aborted");
		});

		const evaluation = await scenario.evaluate();

		expect(evaluation).toBeUndefined();
		expect(scenario.state().transportFailures).toBe(0);

		await scenario.events.get("agent_settled")!(
			{ aborted: true },
			scenario.ctx,
		);

		expect(scenario.state().status).toBe("paused");
	});

	it("handles asynchronous submission rejection", async () => {
		const scenario = fixture();

		scenario.pi.sendUserMessage.mockImplementation(() =>
			Promise.reject(new Error("no credentials")),
		);

		await scenario.run("fix");

		expect(scenario.state().status).toBe("paused");
		expect(scenario.state().reason).toContain("no credentials");
	});

	it("routes virtual models through the simple streaming registry", async () => {
		const scenario = fixture();
		scenario.ctx.model = { id: "virtual" };
		const routed = vi.fn(() => ({ result: () => scenario.complete() }));
		scenario.ctx.modelRegistry.streamSimple = routed;

		await scenario.run("fix");
		await scenario.evaluate();

		expect(routed).toHaveBeenCalled();
		expect(scenario.state().status).toBe("done");
	});

	it("rejects invalid tree snapshots without resurrecting older goals", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		scenario.entries.push({
			type: "custom",
			customType: "goal-state",
			data: { version: 1 },
		});

		await scenario.events.get("session_tree")!({}, scenario.ctx);
		await scenario.run("resume");

		expect(scenario.entries.at(-1).data).toEqual({ version: 1 });
	});

	it("explains threshold pauses", async () => {
		const scenario = fixture(["bad", "bad", "bad"]);

		await scenario.run("fix");
		await scenario.evaluate();
		await scenario.evaluate();
		scenario.ctx.ui.notify.mockClear();

		await scenario.evaluate();

		expect(scenario.ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("malformed judge"),
			"info",
		);
	});

	it("suppresses stale draft fallback notices and accepts fenced contracts", async () => {
		const scenario = fixture();

		scenario.complete.mockImplementationOnce(async () => {
			scenario.events.get("input")!({ source: "interactive" }, scenario.ctx);
			throw new Error("aborted");
		});

		await scenario.run("draft fix");

		expect(scenario.entries).toHaveLength(0);
		expect(scenario.ctx.ui.notify).not.toHaveBeenCalledWith(
			expect.stringContaining("starting"),
			"info",
		);

		const other = fixture(['```json\n{"verification":"tests"}\n```']);

		await other.run("draft fix");

		expect(other.state().contract.verification).toBe("tests");
	});

	it("sends finished process evidence to judging", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		const tool = scenario.pi.registerTool.mock.calls[0]![0] as any;
		const p = JSON.parse(
			(
				await tool.execute(
					"call",
					{ action: "start", command: "printf verified" },
					undefined,
					undefined,
					scenario.ctx,
				)
			).content[0].text,
		);
		try {
			for (let n = 0; n < 100; n++) {
				const out = JSON.parse(
					(
						await tool.execute(
							"out",
							{ action: "output", id: p.id },
							undefined,
							undefined,
							scenario.ctx,
						)
					).content[0].text,
				);
				if (!out.running) break;

				await new Promise((r) => setTimeout(r, 10));
			}

			await scenario.evaluate();
			const input = JSON.parse(
				(scenario.complete.mock.calls[0] as any)[1].messages[0].content,
			);

			expect(input.processes[0].running).toBe(false);
			expect(input.processes[0].code).toBe(0);
			expect(input.processes[0].output).toContain("verified");
		} finally {
			await scenario.events.get("session_shutdown")!({}, scenario.ctx);
		}
	});
});

it("pauses Escape during judging when Pi has no active agent signal", async () => {
	const scenario = fixture();

	await scenario.events.get("session_start")!(
		{ reason: "startup" },
		scenario.ctx,
	);
	await scenario.run("fix");
	const terminalInput = scenario.ctx.ui.onTerminalInput.mock.calls[0][0];

	scenario.complete.mockImplementationOnce(async () => {
		expect(scenario.ctx.signal).toBeUndefined();
		expect(terminalInput("\x1b")).toBeUndefined();

		return {
			stopReason: "stop",
			content: [{ type: "text", text: '{"verdict":"done","reason":"stale"}' }],
		};
	});

	const evaluation = await scenario.evaluate();

	expect(evaluation).toBeUndefined();
	expect(scenario.state().status).toBe("paused");
	expect(scenario.state().reason).toContain("aborted");
	expect(scenario.state().transportFailures).toBe(0);

	await scenario.events.get("session_shutdown")!({}, scenario.ctx);

	expect(
		scenario.ctx.ui.onTerminalInput.mock.results[0].value,
	).toHaveBeenCalledOnce();
});

it("uses the current process registry after session shutdown", async () => {
	const scenario = fixture();
	const list = vi.spyOn(Processes.prototype, "list");
	try {
		const tool = scenario.pi.registerTool.mock.calls[0]![0];

		await tool.execute(
			"list-one",
			{ action: "list" },
			undefined,
			undefined,
			scenario.ctx,
		);
		const firstRegistry = list.mock.contexts.at(-1);

		await scenario.events.get("session_shutdown")!({}, scenario.ctx);
		await tool.execute(
			"list-two",
			{ action: "list" },
			undefined,
			undefined,
			scenario.ctx,
		);

		expect(list.mock.contexts.at(-1)).not.toBe(firstRegistry);
	} finally {
		list.mockRestore();

		await scenario.events.get("session_shutdown")!({}, scenario.ctx);
	}
});
