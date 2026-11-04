import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import plan from "../src/index.js";
import { buildPlanPrompt } from "../src/prompt.js";

describe("planning command", () => {
	function fixture(mode = "tui", trusted = true, idle = true) {
		const sendUserMessage = vi.fn();
		const notify = vi.fn();
		let handler: any;
		const registerCommand = vi.fn((_name, command) => {
			handler = command.handler;
		});
		plan({ registerCommand, sendUserMessage } as unknown as ExtensionAPI);
		return {
			sendUserMessage,
			notify,
			registerCommand,
			run: () =>
				handler(" task ", {
					mode,
					isProjectTrusted: () => trusted,
					isIdle: () => idle,
					ui: { notify },
				}),
		};
	}

	it("submits one ordinary message without expansion", async () => {
		const scenario = fixture();

		await scenario.run();

		expect(scenario.registerCommand.mock.calls[0]?.[0]).toBe("plan");
		expect(scenario.sendUserMessage).toHaveBeenCalledExactlyOnceWith(
			buildPlanPrompt("task"),
			{
				expandPromptTemplates: false,
			},
		);
	});

	it.each([
		["tui", false, true],
		["tui", true, false],
		["print", true, true],
		["json", true, true],
		["rpc", true, true],
	])("rejects ineligible calls %s %s %s", async (mode, trusted, idle) => {
		const scenario = fixture(mode, trusted, idle);

		await scenario.run();

		expect(scenario.sendUserMessage).not.toHaveBeenCalled();
	});

	it("reports submission failure", async () => {
		const scenario = fixture();

		scenario.sendUserMessage.mockImplementation(() => {
			throw new Error("offline");
		});

		await scenario.run();

		expect(scenario.notify).toHaveBeenCalledWith(
			expect.stringContaining("offline"),
			"error",
		);
	});

	it("preserves task and planning contracts", () => {
		const task = "  task\nwith detail  ";

		const prompt = buildPlanPrompt(task);

		for (const text of [
			"task\nwith detail",
			"read-only",
			".pi/plans/",
			"Never overwrite",
			"numeric suffix",
			"expected",
			"Do not implement",
			"Do not start executing",
			"saving fails",
		])
			expect(prompt).toContain(text);
	});

	it("asks the agent to infer an empty task", () => {
		const task = " ";

		const prompt = buildPlanPrompt(task);

		expect(prompt).toContain("Infer the task");
	});
});
