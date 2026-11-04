import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { expect, it, vi } from "vitest";
import footer from "../src/index.js";

function harness(mode = "tui") {
	const events = new Map<string, (e: unknown, c: ExtensionContext) => void>();
	let thinking = "high";
	footer({
		on: (name: string, handler: (e: unknown, c: ExtensionContext) => void) =>
			events.set(name, handler),
		getThinkingLevel: () => thinking,
	} as unknown as ExtensionAPI);
	let branch = "task/footer";

	let branchChanged = () => {};

	const dispose = vi.fn();
	const requestRender = vi.fn();
	const fg = vi.fn((_role: string, text: string) => text);
	let component: {
		render(w: number): string[];
		invalidate(): void;
		dispose(): void;
	};
	const statuses = new Map([
		["z", "\u001b[32m📝 status\u001b[0m"],
		["a", "first\nline\tvalue"],
	]);
	const setFooter = vi.fn((factory) => {
		if (component) component.dispose();
		if (factory)
			component = factory(
				{ requestRender },
				{ fg },
				{
					getGitBranch: () => branch,
					getAvailableProviderCount: () => 2,
					getExtensionStatuses: () => statuses,
					onBranchChange: (fn: () => void) => {
						branchChanged = fn;
						return dispose;
					},
				},
			);
	});
	let session = "one";
	let percent: number | null = 24;
	const usage = {
		input: 100,
		output: 20,
		cacheRead: 300,
		cacheWrite: 0,
		cost: { total: 0.01 },
	};
	const entries = [
		{ type: "message", message: { role: "assistant", usage } },
		{ type: "usage", usage },
		{ type: "compaction", usage },
		{ type: "branch_summary", usage },
		{ type: "message", message: { role: "toolResult", usage } },
	];
	const ctx = {
		mode,
		model: {
			id: "gpt-example",
			provider: "example",
			reasoning: true,
			contextWindow: 500000,
		},
		getContextUsage: () => ({ percent, contextWindow: 500000 }),
		sessionManager: {
			getEntries: () => entries,
			getSessionId: () => session,
			getLeafId: () => "leaf",
			getCwd: () => "/workspace/長い📁",
			getSessionName: () => "Footer session",
		},
		ui: { setFooter },
	} as unknown as ExtensionContext;

	const start = () => events.get("session_start")!({}, ctx);

	return {
		start,
		render: (w: number) => component.render(w),
		setFooter,
		dispose,
		requestRender,
		fg,
		statuses,
		entries,
		ctx,
		changeBranch: () => {
			branch = "changed";
			branchChanged();
		},
		setSession: () => {
			session = "two";
		},
		setThinking: () => {
			thinking = "off";
		},
		setPercent: (p: number | null) => {
			percent = p;
		},
		stop: () => events.get("session_shutdown")!({}, ctx),
	};
}

it.each([0, 1, 20, 80, 120, 200])(
	"fits ANSI and emoji rows within width %s",
	(width) => {
		const harnessState = harness();

		harnessState.start();
		const rows = harnessState.render(width);

		for (const row of rows) {
			expect(visibleWidth(row)).toBeLessThanOrEqual(width);
			expect(row).not.toMatch(/[\r\n\t]/);
		}
	},
);

it("preserves separators, all usage sources and sorted ANSI statuses", () => {
	const harnessState = harness();

	harnessState.start();
	const rows = harnessState.render(250);

	expect(rows[0]).toContain(" (🌿 task/footer) • 🏷️ Footer session");
	expect(rows[1]).toContain("↑500 ↓100 R1.5k CH75.0% 💰 $0.050");
	expect(rows[1]).toContain("(example) 🤖 gpt-example • 🧠 high");
	expect(rows[2]).toBe("first line value \u001b[32m📝 status\u001b[0m");
});

it("refreshes the branch after a notification", () => {
	const harnessState = harness();

	harnessState.start();

	harnessState.changeBranch();
	const rows = harnessState.render(250);

	expect(harnessState.requestRender).toHaveBeenCalledOnce();
	expect(rows[0]).toContain("changed");
});

it("refreshes the thinking level", () => {
	const harnessState = harness();

	harnessState.start();
	harnessState.setThinking();

	const rows = harnessState.render(250);

	expect(rows[1]).toContain("thinking off");
});

it("refreshes usage after session replacement", () => {
	const harnessState = harness();

	harnessState.start();
	harnessState.render(250);
	harnessState.entries.splice(0);

	harnessState.setSession();

	const rows = harnessState.render(250);

	expect(rows[1]).not.toContain("↑500");
});

it("renders unknown context usage", () => {
	const harnessState = harness();

	harnessState.start();
	harnessState.setPercent(null);

	const rows = harnessState.render(250);

	expect(rows[1]).toContain("?/500k");
});

it("releases subscriptions on replacement and shutdown", () => {
	const harnessState = harness();

	harnessState.start();

	harnessState.start();
	const disposalsAfterReplacement = harnessState.dispose.mock.calls.length;

	harnessState.stop();

	expect(disposalsAfterReplacement).toBe(1);
	expect(harnessState.dispose).toHaveBeenCalledTimes(2);
});

it.each([
	[70, "text"],
	[70.1, "warning"],
	[90, "warning"],
	[90.1, "error"],
])("colors context at threshold %s", (percent, role) => {
	const harnessState = harness();

	harnessState.start();
	harnessState.setPercent(Number(percent));
	harnessState.render(250);

	expect(harnessState.fg).toHaveBeenCalledWith(
		role,
		expect.stringContaining("📊"),
	);
});

it.each(["print", "json", "rpc"])("does not install in %s", (mode) => {
	const harnessState = harness(mode);

	harnessState.start();
	harnessState.stop();

	expect(harnessState.setFooter).not.toHaveBeenCalled();
});
