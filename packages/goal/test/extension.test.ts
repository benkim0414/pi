import { describe, expect, it, vi } from "vitest";
import { runGate } from "../src/gates.js";
import * as config from "../src/config.js";
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

	it("pauses when the agent settles after an abort", async () => {
		const scenario = fixture();

		await scenario.run("fix");
		await scenario.events.get("agent_settled")!(
			{ aborted: true },
			scenario.ctx,
		);

		expect(scenario.state().status).toBe("paused");
	});

	it("pauses once on terminal escape and reports the reason", async () => {
		const scenario = fixture();
		await scenario.events.get("session_start")!(
			{ reason: "startup" },
			scenario.ctx,
		);
		await scenario.run("fix");
		const input = scenario.ctx.ui.onTerminalInput.mock.calls[0][0];
		const entries = scenario.entries.length;

		input("\u001b");
		await scenario.events.get("agent_settled")!(
			{ aborted: true },
			scenario.ctx,
		);

		expect(scenario.state().status).toBe("paused");
		expect(scenario.entries).toHaveLength(entries + 1);
		expect(scenario.ctx.ui.notify).toHaveBeenLastCalledWith(
			"Execution aborted; use /goal resume.",
			"info",
		);
		await scenario.events.get("session_shutdown")!({}, scenario.ctx);
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

it("keeps newer draft cancellation owned after an older draft settles", async () => {
	const scenario = fixture();
	let finishOld!: (value: any) => void;
	let finishNew!: (value: any) => void;
	const signals: AbortSignal[] = [];
	scenario.ctx.modelRegistry.streamSimple = (
		_model: any,
		_input: any,
		options: any,
	) => {
		signals.push(options.signal);
		return {
			result: () =>
				new Promise((resolve) => {
					if (signals.length === 1) finishOld = resolve;
					else finishNew = resolve;
				}),
		};
	};
	const old = scenario.run("draft old");
	const newer = scenario.run("draft newer");
	finishOld({ content: [{ type: "text", text: "{}" }], stopReason: "stop" });
	await old;
	scenario.events.get("input")!({ source: "user" }, scenario.ctx);
	const newerAborted = signals[1].aborted;
	finishNew({ content: [{ type: "text", text: "{}" }], stopReason: "stop" });
	await newer;
	expect(newerAborted).toBe(true);
	expect(scenario.pi.sendUserMessage).not.toHaveBeenCalled();
});

it("persists snapshots unaffected by later criteria changes", async () => {
	const scenario = fixture();
	await scenario.run("fix parser");
	const initial = scenario.state();
	await scenario.commands.get("subgoal")!(
		"regression test passes",
		scenario.ctx,
	);
	expect(initial.criteria).toEqual([]);
	expect(scenario.state().criteria).toEqual(["regression test passes"]);
});

it("reserves one turn and continuation for overlapping evaluations", async () => {
	const scenario = fixture();
	await scenario.run("fix");
	let release!: (value: any) => void;
	scenario.complete.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	const first = scenario.evaluate();
	await vi.waitFor(() => expect(scenario.complete).toHaveBeenCalledTimes(1));
	const duplicate = await scenario.evaluate();
	release({
		stopReason: "stop",
		content: [{ type: "text", text: '{"verdict":"continue","reason":"more"}' }],
	});
	const result = await first;
	expect(duplicate).toBeUndefined();
	expect(result?.continue).toBe(true);
	expect(scenario.state().used).toBe(1);
	expect(scenario.complete).toHaveBeenCalledTimes(1);
});

it("discards session loading completed after tree navigation", async () => {
	const scenario = fixture();
	await scenario.run("fix");
	let release!: (value: any) => void;
	const loading = vi.spyOn(config, "loadConfig").mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	try {
		const starting = scenario.events.get("session_start")!(
			{ reason: "resume" },
			scenario.ctx,
		);
		scenario.events.get("session_tree")!({}, scenario.ctx);
		const saved = scenario.entries.length;
		release({ maxTurns: 20 });
		await starting;
		expect(scenario.entries).toHaveLength(saved);
		expect(scenario.state().status).toBe("paused");
		expect(scenario.pi.sendUserMessage).toHaveBeenCalledTimes(1);
	} finally {
		loading.mockRestore();
	}
});

it("keeps the newer session attached when older shutdown finishes", async () => {
	const scenario = fixture();
	let release!: () => void;
	const closing = vi.spyOn(Processes.prototype, "close").mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				release = resolve;
			}),
	);
	try {
		const shutdown = scenario.events.get("session_shutdown")!({}, scenario.ctx);
		await scenario.events.get("session_start")!(
			{ reason: "new" },
			scenario.ctx,
		);
		await scenario.run("fix");
		const oldStatusCalls = scenario.ctx.ui.setStatus.mock.calls.length;
		release();
		await shutdown;
		expect(scenario.ctx.ui.setStatus).toHaveBeenCalledTimes(oldStatusCalls);
		await scenario.run("pause");
		expect(scenario.ctx.ui.setStatus).toHaveBeenLastCalledWith(
			"goal",
			expect.stringContaining("paused"),
		);
	} finally {
		closing.mockRestore();
	}
});

it("ignores submission failure after human input supersedes it", async () => {
	const scenario = fixture();
	let reject!: (reason: Error) => void;
	scenario.pi.sendUserMessage.mockImplementationOnce(
		() =>
			new Promise((_resolve, fail) => {
				reject = fail;
			}),
	);
	const starting = scenario.run("fix");
	scenario.events.get("input")!({ source: "user" }, scenario.ctx);
	reject(new Error("late failure"));
	await starting;
	expect(scenario.state().status).toBe("active");
});

it("restores session state and config despite intervening human input", async () => {
	const scenario = fixture();
	await scenario.run("fix");
	let release!: (value: config.Config) => void;
	const loading = vi.spyOn(config, "loadConfig").mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				release = resolve;
			}),
	);
	try {
		const starting = scenario.events.get("session_start")!(
			{ reason: "resume" },
			scenario.ctx,
		);
		scenario.events.get("input")!({ source: "interactive" }, scenario.ctx);
		release({ maxTurns: 7 });
		await starting;
		await scenario.run("status");
		expect(scenario.ctx.ui.notify).toHaveBeenLastCalledWith(
			expect.stringContaining('"objective": "fix"'),
			"info",
		);
		await scenario.run("replacement");
		expect(scenario.state().limit).toBe(7);
	} finally {
		loading.mockRestore();
	}
});

it.each(["success", "failure"] as const)(
	"settles a wake %s after human input without losing wake ownership",
	async (outcome) => {
		vi.useFakeTimers();
		const scenario = fixture([
			{ verdict: "wait", reason: "cooldown", wait_for_seconds: 1 },
		]);
		try {
			await scenario.run("fix");
			await scenario.evaluate();
			let resolve!: () => void;
			let reject!: (error: Error) => void;
			scenario.pi.sendUserMessage.mockImplementationOnce(
				() =>
					new Promise<void>((done, fail) => {
						resolve = done;
						reject = fail;
					}),
			);
			await vi.advanceTimersByTimeAsync(1000);
			scenario.events.get("input")!({ source: "interactive" }, scenario.ctx);
			scenario.ctx.isIdle = () => false;
			if (outcome === "success") resolve();
			else reject(new Error("send failed"));
			await vi.advanceTimersByTimeAsync(0);
			if (outcome === "success")
				scenario.events.get("agent_settled")!({ aborted: false }, scenario.ctx);
			await vi.advanceTimersByTimeAsync(1000);
			expect(scenario.pi.sendUserMessage).toHaveBeenCalledTimes(2);
			scenario.ctx.isIdle = () => true;
			await vi.advanceTimersByTimeAsync(2000);
			expect(scenario.pi.sendUserMessage).toHaveBeenCalledTimes(
				outcome === "success" ? 2 : 3,
			);
			expect(scenario.state().status).toBe("active");
		} finally {
			await scenario.events.get("session_shutdown")!({}, scenario.ctx);
			vi.useRealTimers();
		}
	},
);

it.each(["judge", "gate"] as const)(
	"evaluates a new human turn while an obsolete %s is still pending",
	async (kind) => {
		const scenario = fixture([{ verdict: "continue", reason: "newer work" }]);
		await scenario.run("fix");
		let finishOld!: () => void;
		let started = false;
		if (kind === "judge") {
			scenario.complete.mockImplementationOnce(
				() =>
					new Promise((resolve) => {
						started = true;
						finishOld = () =>
							resolve({
								stopReason: "stop",
								content: [
									{ type: "text", text: '{"verdict":"done","reason":"stale"}' },
								],
							});
					}),
			);
		} else {
			await scenario.run("gate add npm test");
			vi.mocked(runGate).mockImplementationOnce(
				() =>
					new Promise((_resolve, reject) => {
						started = true;
						finishOld = () => reject(new Error("stale spawn failure"));
					}),
			);
		}
		const old = scenario.evaluate();
		await vi.waitFor(() => expect(started).toBe(true));
		scenario.events.get("input")!({ source: "interactive" }, scenario.ctx);
		const newer = await scenario.evaluate();
		finishOld();
		await old;
		expect(newer?.continue).toBe(true);
		expect(scenario.state().used).toBe(2);
		expect(scenario.state().status).toBe("active");
		expect(scenario.state().reason).toBe("newer work");
	},
);
