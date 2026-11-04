import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "vitest";

const temporaryRoots: string[] = [];

export function fixture(): { root: string; cwd: string; agentDir: string } {
	const root = mkdtempSync(join(tmpdir(), "pi-output-styles-test-"));
	temporaryRoots.push(root);
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	mkdirSync(cwd);
	mkdirSync(agentDir);
	return { root, cwd, agentDir };
}

export function file(path: string, content: string): string {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
	return path;
}

export function settings(
	root: string,
	content: unknown,
	project = true,
	local = false,
): string {
	return file(
		join(
			root,
			...(project ? [".pi", "output-styles"] : ["output-styles"]),
			local ? "settings.local.json" : "settings.json",
		),
		JSON.stringify(content),
	);
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0))
		rmSync(root, { recursive: true, force: true });
});
