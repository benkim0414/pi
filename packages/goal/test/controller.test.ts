import type {
	AgentBeforeSettleEvent,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { requestAuxiliary } from "../src/auxiliary.js";
import { GoalController } from "../src/controller.js";
import { parseCommand } from "../src/domain.js";

vi.mock("../src/auxiliary.js", () => ({ requestAuxiliary: vi.fn() }));

function fixture() {
	const api = { appendEntry: vi.fn(), sendUserMessage: vi.fn() };
	const context = {
		mode: "tui",
		cwd: "/tmp",
		isProjectTrusted: () => true,
		isIdle: () => true,
		hasPendingMessages: () => false,
		ui: { notify: vi.fn(), setStatus: vi.fn() },
	} as unknown as ExtensionContext;
	const event = {
		outcome: "completed",
		continue: false,
		entries: [],
		context: { contextMessages: [] },
	} as unknown as AgentBeforeSettleEvent;
	const controller = new GoalController(api);
	return {
		api,
		context,
		event,
		controller,
		run: (text: string) => controller.execute(parseCommand(text), context),
	};
}

function pendingReply() {
	let resolve!: (text: string) => void;
	const promise = new Promise<string>((done) => {
		resolve = done;
	});
	vi.mocked(requestAuxiliary).mockReturnValueOnce(promise);
	return { resolve };
}

describe("goal transition ownership", () => {
	it("exposes snapshots without allowing changes to live or persisted goals", async () => {
		const { controller, api, context, run } = fixture();
		await run("fix parser");
		const snapshot = controller.snapshot()!;
		const saved = api.appendEntry.mock.calls.at(-1)![1];

		snapshot.criteria.push("external edit");
		controller.subgoal("regression test passes", context);

		expect(controller.snapshot()?.criteria).toEqual(["regression test passes"]);
		expect(saved.criteria).toEqual([]);
		expect(api.appendEntry.mock.calls.at(-1)![1].criteria).toEqual([
			"regression test passes",
		]);
	});

	it("pauses without accepting an outstanding judge reply", async () => {
		const { controller, context, event, run } = fixture();
		await run("fix parser");
		const reply = pendingReply();
		const evaluation = controller.evaluate(event, context);
		await Promise.resolve();
		const signal = vi.mocked(requestAuxiliary).mock.calls.at(-1)![4];

		await run("pause");
		reply.resolve('{"verdict":"done","reason":"late"}');
		const result = await evaluation;

		expect(signal.aborted).toBe(true);
		expect(result).toBeUndefined();
		expect(controller.snapshot()?.status).toBe("paused");
		expect(controller.snapshot()?.reason).toBe("User paused");
	});

	it.each(["criterion", "gate"])(
		"invalidates evaluation when a %s changes",
		async (edit) => {
			const { controller, context, event, api, run } = fixture();
			await run("fix parser");
			const revision = controller.snapshot()!.revision;
			const reply = pendingReply();
			const evaluation = controller.evaluate(event, context);
			await Promise.resolve();
			const signal = vi.mocked(requestAuxiliary).mock.calls.at(-1)![4];

			if (edit === "criterion")
				controller.subgoal("regression passes", context);
			else await run("gate add true");
			reply.resolve('{"verdict":"done","reason":"obsolete evidence"}');
			const result = await evaluation;

			expect(signal.aborted).toBe(true);
			expect(result).toBeUndefined();
			expect(controller.snapshot()).toMatchObject({
				status: "active",
				revision: revision + 1,
			});
			expect(api.appendEntry.mock.calls.at(-1)![1]).toEqual(
				controller.snapshot(),
			);
		},
	);

	it("discards a draft after human input without submitting or reporting fallback", async () => {
		const { controller, context, api, run } = fixture();
		const reply = pendingReply();
		const draft = run("draft fix parser");
		const signal = vi.mocked(requestAuxiliary).mock.calls.at(-1)![4];

		controller.input("interactive", context);
		reply.resolve("invalid draft");
		await draft;

		expect(signal.aborted).toBe(true);
		expect(controller.snapshot()).toBeUndefined();
		expect(api.appendEntry).not.toHaveBeenCalled();
		expect(api.sendUserMessage).not.toHaveBeenCalled();
		expect(context.ui.notify).not.toHaveBeenCalled();
	});

	it("keeps a newer draft cancellable after an older draft finishes", async () => {
		const { controller, context, api, run } = fixture();
		const older = pendingReply();
		const first = run("draft old objective");
		const newer = pendingReply();
		const second = run("draft new objective");
		const signal = vi.mocked(requestAuxiliary).mock.calls.at(-1)![4];

		older.resolve("{}");
		await first;
		controller.input("interactive", context);
		newer.resolve("{}");
		await second;

		expect(signal.aborted).toBe(true);
		expect(controller.snapshot()).toBeUndefined();
		expect(api.sendUserMessage).not.toHaveBeenCalled();
	});

	it("cancels a waiting goal without submitting after the deadline", async () => {
		vi.useFakeTimers();
		const { controller, context, event, api, run } = fixture();
		try {
			await run("fix parser");
			vi.mocked(requestAuxiliary).mockResolvedValueOnce(
				'{"verdict":"wait","reason":"cooldown","wait_for_seconds":2}',
			);
			await controller.evaluate(event, context);
			const waiting = controller.snapshot()?.wait;

			await run("clear");
			await vi.advanceTimersByTimeAsync(3000);

			expect(waiting?.kind).toBe("time");
			expect(controller.snapshot()).toMatchObject({
				status: "cleared",
				wait: undefined,
			});
			expect(api.sendUserMessage).toHaveBeenCalledOnce();
		} finally {
			await controller.dispose();
			vi.useRealTimers();
		}
	});
});
