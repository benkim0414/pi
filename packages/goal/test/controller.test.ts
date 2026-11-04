import { describe, expect, it, vi } from "vitest";
import { GoalController } from "../src/controller.js";
import { newGoal } from "../src/domain.js";

function fixture() {
	const api = { appendEntry: vi.fn(), sendUserMessage: vi.fn() };
	return { api, controller: new GoalController(api) };
}

describe("goal lifecycle ownership", () => {
	it("invalidates captured work on human input and aborts pending requests", () => {
		const { controller } = fixture();
		const current = controller.captureInput();
		controller.pending = new AbortController();

		const currentBeforeInput = current();

		controller.onHumanInput();

		expect(currentBeforeInput).toBe(true);
		expect(current()).toBe(false);
		expect(controller.pending.signal.aborted).toBe(true);
	});

	it("invalidates captures and releases pending cancellation on controls", () => {
		const { controller } = fixture();
		const current = controller.captureInput();
		const pending = new AbortController();
		controller.pending = pending;
		controller.wakePending = true;

		controller.invalidate();

		expect(current()).toBe(false);
		expect(pending.signal.aborted).toBe(true);
		expect(controller.pending).toBeUndefined();
		expect(controller.wakePending).toBe(false);
	});

	it("persists a snapshot rather than the mutable live goal", () => {
		const { controller, api } = fixture();
		controller.goal = newGoal("fix parser");

		controller.save();
		controller.goal.criteria.push("regression test passes");

		expect(api.appendEntry).toHaveBeenCalledWith(
			"goal-state",
			expect.objectContaining({ criteria: [] }),
		);
	});
});
