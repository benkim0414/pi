import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { runGate } from "../src/gates.js";

describe.skipIf(process.platform === "win32")("bounded gate runner", () => {
	it("retains only bounded output from a verbose gate", async () => {
		const result = await runGate(
			"yes x | head -c 100000",
			"/tmp",
			new AbortController().signal,
		);

		expect(result.code).toBe(0);
		expect(result.output.length).toBe(3000);
	});

	it("kills the process group on timeout", async () => {
		const result = await runGate(
			"sleep 30 & echo $!; wait",
			"/tmp",
			new AbortController().signal,
			50,
		);

		expect(result.killed).toBe(true);
		expect(result.code).not.toBe(0);

		const pid = Number(result.output.trim());

		expect(pid).toBeGreaterThan(0);

		if (process.platform === "linux") {
			const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "");

			expect(!stat || stat.split(" ")[2] === "Z").toBe(true);
		}
	});

	it("stops a running gate on abort", async () => {
		const abort = new AbortController();
		const run = runGate("sleep 30", "/tmp", abort.signal);

		abort.abort();
		const result = await run;

		expect(result.killed).toBe(true);
	});

	it("rejects an already aborted gate request", async () => {
		const abort = new AbortController();
		abort.abort();

		await expect(runGate("true", "/tmp", abort.signal)).rejects.toThrow();
	});
});
