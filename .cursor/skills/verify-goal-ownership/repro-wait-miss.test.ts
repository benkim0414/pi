/**
 * Code replay of TLC NoSilentWaitContinue against GoalController.
 * Not a product test — lives with the formal skill. Do not move into packages/goal/test.
 *
 * Asserts the product promise (wait must not silently continue). This test fails
 * on the original defect and passes when commitVerdict refuses an unavailable wait.
 */
import type {
	AgentBeforeSettleEvent,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { requestAuxiliary } from "../../../packages/goal/src/auxiliary.js";
import { GoalController } from "../../../packages/goal/src/controller.js";
import { parseCommand } from "../../../packages/goal/src/domain.js";

vi.mock("../../../packages/goal/src/auxiliary.js", () => ({
	requestAuxiliary: vi.fn(),
}));

describe("NoSilentWaitContinue (formal finding)", () => {
	it("does not continue when the judge waits on a dead pid", async () => {
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

		await controller.execute(parseCommand("fix parser"), context);
		vi.mocked(requestAuxiliary).mockResolvedValueOnce(
			JSON.stringify({
				verdict: "wait",
				reason: "waiting on missing process",
				wait_on_pid: 999_999_999,
			}),
		);

		const result = await controller.evaluate(event, context);

		expect(controller.snapshot()?.status).toBe("paused");
		// Product promise: wait parks or refuses; it must not request continuation.
		expect(result?.continue).not.toBe(true);
	});
});
