import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

it.each([
	["valid", { maxTurns: 3 }, 3, 0],
	["invalid", { maxTurns: 0, judge: {} }, 7, 2],
] as const)(
	"loads %s project overrides over personal defaults",
	async (_kind, override, expectedMaxTurns, diagnosticCount) => {
		const root = await mkdtemp(join(tmpdir(), "goal-config-"));
		const diagnostics: string[] = [];
		try {
			const agent = join(root, "agent");
			const project = join(root, "project");

			await mkdir(agent);
			await mkdir(join(project, ".pi"), { recursive: true });
			await writeFile(
				join(agent, "goal.json"),
				JSON.stringify({ maxTurns: 7, judge: { provider: "p", model: "m" } }),
			);
			await writeFile(
				join(project, ".pi", "goal.json"),
				JSON.stringify(override),
			);

			const config = await loadConfig(agent, project, (message) =>
				diagnostics.push(message),
			);

			expect(config).toEqual({
				maxTurns: expectedMaxTurns,
				provider: "p",
				model: "m",
			});
			expect(diagnostics).toHaveLength(diagnosticCount);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	},
);
