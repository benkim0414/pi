import { randomUUID } from "node:crypto";
import {
	closeSync,
	lstatSync,
	openSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
	errorMessage,
	isMissing,
	readRegularFile,
	styleDirectory,
} from "./files.js";

function readSettings(path: string): Record<string, unknown> {
	let content: string;
	try {
		content = readRegularFile(path);
	} catch (error) {
		if (isMissing(error)) return {};
		throw error;
	}
	let settings: unknown;
	try {
		settings = JSON.parse(content);
	} catch (error) {
		throw new Error(`${path}: invalid JSON (${errorMessage(error)}).`);
	}
	if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
		throw new Error(`${path} must contain a JSON object.`);
	}
	return settings as Record<string, unknown>;
}

export function loadSelection(
	roots: string[],
	agentDir: string,
): {
	name: string;
	source?: string;
	diagnostics: string[];
} {
	const diagnostics: string[] = [];
	const scopes = [
		...roots.map((root) => ({
			root,
			project: true,
			file: "settings.local.json",
		})),
		...roots.map((root) => ({ root, project: true, file: "settings.json" })),
		{ root: agentDir, project: false, file: "settings.json" },
	];
	for (const scope of scopes) {
		try {
			const directory = styleDirectory(scope.root, scope.project);
			if (!directory) continue;
			const path = join(directory, scope.file);
			const settings = readSettings(path);
			if (settings.outputStyle === undefined) continue;
			if (
				typeof settings.outputStyle !== "string" ||
				!settings.outputStyle.trim()
			) {
				throw new Error(`${path}: outputStyle must be a nonempty string.`);
			}
			return { name: settings.outputStyle, source: path, diagnostics };
		} catch (error) {
			diagnostics.push(
				`Cannot load output-style selection: ${errorMessage(error)}. Repair the settings and /reload.`,
			);
		}
	}
	return { name: "Default", diagnostics };
}

export function saveSelection(cwd: string, name: string): void {
	const directory = styleDirectory(cwd, true, true)!;
	const path = join(directory, "settings.local.json");
	const settings = readSettings(path);
	// Replace the resolved target atomically so an existing symlink stays intact.
	let target = path;
	try {
		lstatSync(path);
		target = realpathSync(path);
	} catch (error) {
		if (!isMissing(error)) throw error;
	}
	const temporary = join(dirname(target), `.settings-${randomUUID()}.tmp`);
	let created = false;
	try {
		const descriptor = openSync(temporary, "wx", 0o600);
		created = true;
		try {
			writeFileSync(
				descriptor,
				`${JSON.stringify({ ...settings, outputStyle: name }, null, 2)}\n`,
			);
		} finally {
			closeSync(descriptor);
		}
		// Refuse replacement if the target changed while saving.
		try {
			if (realpathSync(path) !== target || !lstatSync(target).isFile()) {
				throw new Error(`${path}: settings target changed while saving.`);
			}
		} catch (error) {
			if (!isMissing(error)) throw error;
		}
		renameSync(temporary, target);
		created = false;
	} finally {
		if (created) unlinkSync(temporary);
	}
}
