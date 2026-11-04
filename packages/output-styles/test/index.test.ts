import { mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type {
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, it, vi } from "vitest";
import extension from "../src/index.js";
import { file, fixture, settings } from "./fixtures.js";

const host = vi.hoisted(() => ({ agentDir: "" }));

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => ({
	...(await importOriginal<typeof import("@earendil-works/pi-coding-agent")>()),
	getAgentDir: () => host.agentDir,
}));

function harness() {
	const fixtures = fixture();
	host.agentDir = fixtures.agentDir;
	const events = new Map<
		string,
		(event: unknown, ctx: ExtensionContext) => unknown
	>();
	const registerCommand = vi.fn<ExtensionAPI["registerCommand"]>();

	const on = (
		name: string,
		handler: (event: unknown, ctx: ExtensionContext) => unknown,
	) => {
		events.set(name, handler);
	};

	extension({ on, registerCommand } as unknown as ExtensionAPI);
	const notify = vi.fn();
	const select = vi.fn().mockResolvedValue(undefined);
	const setStatus = vi.fn();
	const fg = vi.fn((_color: string, text: string) => text);
	let trusted = true;
	const ctx = {
		cwd: fixtures.cwd,
		mode: "tui",
		isProjectTrusted: () => trusted,
		ui: { notify, select, setStatus, theme: { fg } },
	} as unknown as ExtensionCommandContext;
	const command = registerCommand.mock.calls[0]![1];

	function start() {
		return events.get("session_start")!({}, ctx);
	}

	function run(
		base = "Pi engineering instructions\nProject guidance\nOther extension instructions",
	) {
		const event = {
			type: "before_agent_start",
			messageType: "user",
			prompt: "Work",
			systemPrompt: base,
		} as BeforeAgentStartEvent;
		return events.get("before_agent_start")!(event, ctx) as
			| { systemPrompt: string }
			| undefined;
	}

	return {
		...fixtures,
		ctx,
		command,
		start,
		run,
		registerCommand,
		events,
		notify,
		select,
		setStatus,
		fg,
		trust: (value: boolean) => {
			trusted = value;
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe("output-style extension", () => {
	it("registers once without loading files or notifying at factory time", () => {
		const harnessState = harness();

		expect(harnessState.registerCommand).toHaveBeenCalledExactlyOnceWith(
			"output-style",
			expect.objectContaining({ handler: expect.any(Function) }),
		);
		expect(harnessState.notify).not.toHaveBeenCalled();

		const startupPrompt = harnessState.run();

		expect(startupPrompt).toBeUndefined();
		expect(harnessState.setStatus).toHaveBeenLastCalledWith(
			"output-styles",
			"📝 style: Default",
		);
	});

	it("styles the label, name, and unavailable feedback with the current theme and clears on shutdown", async () => {
		const harnessState = harness();

		harnessState.fg.mockImplementation(
			(color, text) => `<${color}>${text}</${color}>`,
		);

		settings(harnessState.cwd, { outputStyle: "missing" }, true, true);

		harnessState.start();

		expect(harnessState.setStatus).toHaveBeenLastCalledWith(
			"output-styles",
			"📝 <muted>style: </muted><text>Default</text><muted> (missing unavailable)</muted>",
		);

		harnessState.fg.mockImplementation((color, text) => `[${color}]${text}`);

		await harnessState.command.handler("Concise", harnessState.ctx);

		expect(harnessState.setStatus).toHaveBeenLastCalledWith(
			"output-styles",
			"📝 [muted]style: [text]Concise",
		);

		harnessState.events.get("session_shutdown")!({}, harnessState.ctx);

		expect(harnessState.setStatus).toHaveBeenLastCalledWith(
			"output-styles",
			undefined,
		);
	});

	it.each([
		[
			"ASD-STE100",
			"Use practical Simplified Technical English based on ASD-STE100",
		],
		["ELI5", "It's been a long day and my brain is fried"],
	])(
		"selects, persists, restores, and removes built-in %s without personal files",
		async (name, instruction) => {
			const harnessState = harness();

			harnessState.start();

			const defaultPrompt = harnessState.run();

			expect(defaultPrompt).toBeUndefined();
			expect(
				harnessState.command.getArgumentCompletions?.(
					name.toLowerCase().slice(0, 3),
				),
			).toEqual([expect.objectContaining({ value: name, label: name })]);

			harnessState.select.mockImplementation(
				async (_title: string, options: string[]) =>
					options.find(
						(option) =>
							option.startsWith(`${name} —`) && option.endsWith("[built-in]"),
					),
			);

			await harnessState.command.handler("", harnessState.ctx);

			const selectedPrompt = harnessState.run()!.systemPrompt;

			expect(selectedPrompt).toContain(instruction);

			await harnessState.command.handler(name.toLowerCase(), harnessState.ctx);

			expect(harnessState.setStatus).toHaveBeenLastCalledWith(
				"output-styles",
				`📝 style: ${name}`,
			);
			expect(
				JSON.parse(
					readFileSync(
						join(
							harnessState.cwd,
							".pi",
							"output-styles",
							"settings.local.json",
						),
						"utf8",
					),
				),
			).toEqual({ outputStyle: name });

			harnessState.start();
			const prompt = harnessState.run("Existing Pi instructions")!.systemPrompt;

			expect(prompt).toContain("Existing Pi instructions");
			expect(prompt).toContain("tool permissions in effect");
			expect(prompt).toContain(instruction);
			expect(prompt).not.toContain("keep-coding-instructions:");
			expect(prompt.match(/<pi_output_style>/g)).toHaveLength(1);

			const next = name === "ELI5" ? "ASD-STE100" : "ELI5";

			await harnessState.command.handler(next, harnessState.ctx);

			const replacementPrompt = harnessState.run()!.systemPrompt;

			expect(replacementPrompt).not.toContain(instruction);

			await harnessState.command.handler("default", harnessState.ctx);

			const resetPrompt = harnessState.run();

			expect(resetPrompt).toBeUndefined();
			expect(harnessState.setStatus).toHaveBeenLastCalledWith(
				"output-styles",
				"📝 style: Default",
			);
		},
	);

	it("preserves the prompt and replaces or removes contributed instructions between runs", async () => {
		const harnessState = harness();

		harnessState.start();

		const defaultPrompt = harnessState.run();

		expect(defaultPrompt).toBeUndefined();

		await harnessState.command.handler("cOnCiSe", harnessState.ctx);
		const concisePrompt = harnessState.run()!.systemPrompt;

		expect(concisePrompt).toContain(
			"Pi engineering instructions\nProject guidance\nOther extension instructions",
		);
		expect(concisePrompt).toContain("Lead the response with the result");
		expect(concisePrompt.match(/<pi_output_style>/g)).toHaveLength(1);

		const repeatedConcisePrompt = harnessState.run()!.systemPrompt;

		expect(repeatedConcisePrompt).toBe(concisePrompt);

		await harnessState.command.handler("Explanatory", harnessState.ctx);

		const explanatoryPrompt = harnessState.run()!.systemPrompt;

		expect(explanatoryPrompt).toContain('blocks labeled "Insight"');

		const repeatedExplanatoryPrompt = harnessState.run()!.systemPrompt;

		expect(repeatedExplanatoryPrompt).not.toContain(
			"Lead the response with the result",
		);

		await harnessState.command.handler("default", harnessState.ctx);

		const resetPrompt = harnessState.run();

		expect(resetPrompt).toBeUndefined();
		expect(
			JSON.parse(
				readFileSync(
					join(harnessState.cwd, ".pi", "output-styles", "settings.local.json"),
					"utf8",
				),
			),
		).toEqual({ outputStyle: "Default" });
	});

	it("completes names and shows descriptions, sources, and the current choice without changing on cancel", async () => {
		const harnessState = harness();

		harnessState.start();

		expect(harnessState.command.getArgumentCompletions?.("cOn")).toEqual([
			expect.objectContaining({ value: "Concise" }),
		]);
		expect(harnessState.command.getArgumentCompletions?.("missing")).toBeNull();

		await harnessState.command.handler("", harnessState.ctx);

		expect(harnessState.select).toHaveBeenCalledWith(
			"Output style: Default",
			expect.arrayContaining([
				expect.stringContaining("Default (current)"),
				expect.stringContaining("[built-in]"),
			]),
		);

		const cancelledPrompt = harnessState.run();

		expect(cancelledPrompt).toBeUndefined();
	});

	it("selects a custom style containing spaces from the picker and by name", async () => {
		const harnessState = harness();
		file(
			join(harnessState.agentDir, "output-styles", "diagram.md"),
			"---\nname: Diagrams first\n---\nDraw a diagram.",
		);

		harnessState.start();

		harnessState.select.mockImplementation(
			async (_title: string, options: string[]) =>
				options.find((s) => s.startsWith("Diagrams first")),
		);

		await harnessState.command.handler("", harnessState.ctx);

		const pickedPrompt = harnessState.run()!.systemPrompt;

		expect(pickedPrompt).toContain("Draw a diagram.");

		await harnessState.command.handler("default", harnessState.ctx);
		await harnessState.command.handler("  diagrams FIRST  ", harnessState.ctx);

		const namedPrompt = harnessState.run()!.systemPrompt;

		expect(namedPrompt).toContain("Draw a diagram.");
	});

	it("rejects unknown names and failed saves without changing active selection", async () => {
		const harnessState = harness();

		harnessState.start();
		await harnessState.command.handler("Concise", harnessState.ctx);
		await harnessState.command.handler("unknown", harnessState.ctx);

		expect(harnessState.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("Unknown output style"),
			"error",
		);

		const path = join(
			harnessState.cwd,
			".pi",
			"output-styles",
			"settings.local.json",
		);
		file(path, "broken");

		await harnessState.command.handler("Learning", harnessState.ctx);

		expect(harnessState.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("Selection unchanged"),
			"error",
		);

		const unchangedPrompt = harnessState.run()!.systemPrompt;

		expect(unchangedPrompt).toContain("Lead the response with the result");
		expect(readFileSync(path, "utf8")).toBe("broken");
	});

	it("reloads snapshots and saved selections on session startup, resume, and branch replacement", async () => {
		const harnessState = harness();
		const path = file(
			join(harnessState.cwd, ".pi", "output-styles", "custom.md"),
			"Original snapshot",
		);
		settings(harnessState.cwd, { outputStyle: "custom" }, true, true);

		harnessState.start();

		const originalPrompt = harnessState.run()!.systemPrompt;

		expect(originalPrompt).toContain("Original snapshot");

		file(path, "Edited snapshot");

		const cachedOriginalPrompt = harnessState.run()!.systemPrompt;

		expect(cachedOriginalPrompt).not.toContain("Edited snapshot");

		harnessState.start();

		const reloadedPrompt = harnessState.run()!.systemPrompt;

		expect(reloadedPrompt).toContain("Edited snapshot");

		unlinkSync(path);

		const cachedEditedPrompt = harnessState.run()!.systemPrompt;

		expect(cachedEditedPrompt).toContain("Edited snapshot");

		harnessState.start();

		const missingStylePrompt = harnessState.run();

		expect(missingStylePrompt).toBeUndefined();
		expect(harnessState.notify).toHaveBeenCalledWith(
			expect.stringContaining('"custom"'),
			"warning",
		);
		expect(harnessState.setStatus).toHaveBeenLastCalledWith(
			"output-styles",
			"📝 style: Default (custom unavailable)",
		);

		file(path, "Repaired");

		harnessState.start();

		const repairedPrompt = harnessState.run()!.systemPrompt;

		expect(repairedPrompt).toContain("Repaired");

		settings(harnessState.cwd, { outputStyle: "Learning" }, true, true);
		harnessState.events.get("session_shutdown")!({}, harnessState.ctx);

		harnessState.start();

		const restartedPrompt = harnessState.run()!.systemPrompt;

		expect(restartedPrompt).toContain("TODO(human)");

		const replacement = join(harnessState.root, "replacement");
		mkdirSync(replacement);
		harnessState.ctx.cwd = replacement;

		harnessState.start();

		const replacementSessionPrompt = harnessState.run();

		expect(replacementSessionPrompt).toBeUndefined();
	});

	it("uses exact saved names and defaults for unknown selections", () => {
		const harnessState = harness();
		settings(harnessState.cwd, { outputStyle: "concise" }, true, true);

		harnessState.start();

		const fallbackPrompt = harnessState.run();

		expect(fallbackPrompt).toBeUndefined();
		expect(harnessState.notify).toHaveBeenCalledWith(
			expect.stringContaining("unavailable"),
			"warning",
		);
	});

	it("removes project-derived instructions when trust is lost and blocks project writes", async () => {
		const harnessState = harness();
		file(
			join(harnessState.cwd, ".pi", "output-styles", "project.md"),
			"Trusted project style",
		);
		settings(harnessState.cwd, { outputStyle: "project" }, true, true);
		settings(harnessState.agentDir, { outputStyle: "Concise" }, false);

		harnessState.start();

		const trustedPrompt = harnessState.run()!.systemPrompt;

		expect(trustedPrompt).toContain("Trusted project style");

		harnessState.trust(false);

		const untrustedPrompt = harnessState.run()!.systemPrompt;

		expect(untrustedPrompt).not.toContain("Trusted project style");

		const personalPrompt = harnessState.run()!.systemPrompt;

		expect(personalPrompt).toContain("Lead the response with the result");

		await harnessState.command.handler("Learning", harnessState.ctx);

		expect(harnessState.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("before Pi grants project trust"),
			"error",
		);

		harnessState.trust(true);

		const restoredTrustPrompt = harnessState.run()!.systemPrompt;

		expect(restoredTrustPrompt).toContain("Trusted project style");
	});

	it("discards a picker result after session replacement", async () => {
		const harnessState = harness();

		harnessState.start();

		harnessState.select.mockImplementation(
			async (_title: string, options: string[]) => {
				harnessState.start();
				return options.find((s) => s.startsWith("Concise"));
			},
		);

		await harnessState.command.handler("", harnessState.ctx);

		const discardedSelectionPrompt = harnessState.run();

		expect(discardedSelectionPrompt).toBeUndefined();
		expect(harnessState.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("session or project trust changed"),
			"warning",
		);
	});

	it.each(["print", "json", "rpc"] as const)(
		"has no UI, persistence, or prompt effects in %s mode",
		async (mode) => {
			const harnessState = harness();
			settings(harnessState.agentDir, { outputStyle: "Learning" }, false);
			harnessState.ctx.mode = mode;

			harnessState.start();
			await harnessState.command.handler("Concise", harnessState.ctx);

			const nonInteractivePrompt = harnessState.run();

			expect(nonInteractivePrompt).toBeUndefined();

			harnessState.events.get("session_shutdown")!({}, harnessState.ctx);

			expect(harnessState.select).not.toHaveBeenCalled();
			expect(harnessState.notify).not.toHaveBeenCalled();
			expect(harnessState.setStatus).not.toHaveBeenCalled();

			harnessState.ctx.mode = "tui";

			harnessState.start();

			const interactivePrompt = harnessState.run()!.systemPrompt;

			expect(interactivePrompt).toContain("TODO(human)");
		},
	);
});

it.each(["trust", "directory"])(
	"discards a pending selection after %s changes",
	async (change) => {
		const harnessState = harness();
		settings(harnessState.cwd, { outputStyle: "Default" }, true, true);

		harnessState.start();

		harnessState.select.mockImplementation(
			async (_title: string, options: string[]) => {
				if (change === "trust") harnessState.trust(false);
				else harnessState.ctx.cwd = join(harnessState.root, "another-project");
				return options.find((option) => option.startsWith("Concise"));
			},
		);

		await harnessState.command.handler("", harnessState.ctx);

		expect(
			JSON.parse(
				readFileSync(
					join(harnessState.cwd, ".pi/output-styles/settings.local.json"),
					"utf8",
				),
			),
		).toEqual({ outputStyle: "Default" });
		expect(harnessState.notify).toHaveBeenLastCalledWith(
			expect.stringContaining("session or project trust changed"),
			"warning",
		);
	},
);
