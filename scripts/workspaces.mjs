import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (existsSync("packages")) {
	const result = spawnSync(
		"npm",
		["run", process.argv[2], "--workspaces", "--if-present"],
		{ stdio: "inherit" },
	);
	if (result.error) console.error(result.error);
	process.exit(result.status ?? 1);
}
