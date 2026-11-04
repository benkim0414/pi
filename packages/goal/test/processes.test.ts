import { describe, expect, it } from "vitest";
import { Processes, pidAlive } from "../src/processes.js";

async function until(check: () => boolean): Promise<void> {
	const deadline = Date.now() + 5000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error("Process did not settle");

		await new Promise((r) => setTimeout(r, 10));
	}
}

describe.skipIf(process.platform === "win32")(
	"official local terminal adapter",
	() => {
		it("captures output and exit with bounded retention", async () => {
			const registry = new Processes(() => {});
			try {
				const p = await registry.start("printf 'verified'", "/tmp");

				await until(() => !registry.get(p.id).running);

				expect(registry.get(p.id).output).toContain("verified");
				expect(registry.get(p.id).code).toBe(0);
			} finally {
				await registry.close();
			}
		});

		it("signals literal patterns before process exit and supports stop", async () => {
			let changes = 0;
			const registry = new Processes(() => {
				changes++;
			});
			try {
				const p = await registry.start("printf READY; sleep 30", "/tmp", [
					"READY",
				]);

				await until(() => registry.get(p.id).triggered);

				expect(registry.get(p.id).running).toBe(true);
				expect(changes).toBeGreaterThan(0);

				registry.stop(p.id);

				await until(() => !registry.get(p.id).running);
			} finally {
				await registry.close();
			}
		});

		it("rejects unowned process control and dead PIDs", async () => {
			const registry = new Processes(() => {});
			try {
				expect(() => registry.stop("other")).toThrow();
				expect(pidAlive(2147483647)).toBe(false);
			} finally {
				await registry.close();
			}
		});
	},
);

it.skipIf(process.platform === "win32")(
	"preserves split UTF-8 output and matching",
	async () => {
		const registry = new Processes(() => {});
		try {
			const p = await registry.start(
				"printf '\\342'; sleep 0.05; printf '\\234\\223'",
				"/tmp",
				["✓"],
			);

			await until(() => !registry.get(p.id).running);

			expect(registry.get(p.id).output).toContain("✓");
			expect(registry.get(p.id).output).not.toContain("�");
			expect(registry.get(p.id).triggered).toBe(true);
		} finally {
			await registry.close();
		}
	},
);
