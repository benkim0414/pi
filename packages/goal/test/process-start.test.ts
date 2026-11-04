import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
	starts: [] as Array<{
		resolve: (value: any) => void;
		reject: (error: Error) => void;
	}>,
}));

vi.mock("@earendil-works/pi-env", () => ({
	Connection: class {
		close() {}
	},
	localDaemon: () => "/unused",
	openTerminal: vi.fn(
		() =>
			new Promise((resolve, reject) => state.starts.push({ resolve, reject })),
	),
}));

import { Processes } from "../src/processes.js";

it("reserves in-flight starts and releases reservations on failure", async () => {
	const registry = new Processes(() => {});
	state.starts = [];
	const requests = Array.from({ length: 100 }, () =>
		registry.start("true", "/tmp").catch(() => undefined),
	);

	await expect(registry.start("true", "/tmp")).rejects.toThrow("limit");

	state.starts.forEach((p) => {
		p.reject(new Error("failed"));
	});

	await Promise.all(requests);
	const retry = registry.start("true", "/tmp");
	state.starts.at(-1)!.reject(new Error("new failure"));

	await expect(retry).rejects.toThrow("new failure");
	await registry.close();
});

it("closes a terminal opened after its tool call was aborted", async () => {
	const registry = new Processes(() => {});
	const abort = new AbortController();
	const request = registry.start("sleep 30", "/tmp", [], abort.signal);
	abort.abort();
	const close = vi.fn();
	state.starts.at(-1)!.resolve({ pid: 123, close, exited: Promise.resolve(0) });

	await expect(request).rejects.toThrow("aborted");

	expect(close).toHaveBeenCalledOnce();
	expect(registry.list()).toEqual([]);

	await registry.close();
});
