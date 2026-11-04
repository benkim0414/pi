import { lstatSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function isMissing(error: unknown): boolean {
	return (error as NodeJS.ErrnoException).code === "ENOENT";
}

// Resolve symlinks and check the target type before reading resources.
export function styleDirectory(
	root: string,
	project: boolean,
	create = false,
): string | undefined {
	let directory = root;
	for (const part of project ? [".pi", "output-styles"] : ["output-styles"]) {
		directory = join(directory, part);
		if (create) createDirectory(directory);
		try {
			validateDirectory(directory);
		} catch (error) {
			if (!create && isMissing(error)) return undefined;
			throw error;
		}
	}
	return directory;
}

export function readRegularFile(path: string): string {
	let stat = lstatSync(path);
	if (stat.isSymbolicLink()) {
		try {
			stat = statSync(path);
		} catch (error) {
			throw new Error(
				`${path}: cannot read file symlink (${errorMessage(error)}).`,
			);
		}
	}
	if (!stat.isFile()) {
		throw new Error(`${path} must resolve to a regular file.`);
	}
	return readFileSync(path, "utf8");
}

export function projectRoots(cwd: string): string[] {
	const roots: string[] = [];
	let directory = resolve(cwd);
	for (;;) {
		roots.push(directory);
		try {
			const stat = lstatSync(join(directory, ".git"));
			if (stat.isFile() || stat.isDirectory()) return roots;
		} catch (error) {
			if (!isMissing(error)) throw error;
		}
		const parent = dirname(directory);
		if (parent === directory) return [resolve(cwd)];
		directory = parent;
	}
}

function validateDirectory(directory: string): void {
	const stat = lstatSync(directory);
	if (stat.isSymbolicLink()) {
		let target: ReturnType<typeof statSync>;
		try {
			target = statSync(directory);
		} catch (error) {
			throw new Error(
				`${directory}: cannot read directory symlink (${errorMessage(error)}).`,
			);
		}
		if (!target.isDirectory())
			throw new Error(`${directory} must resolve to a directory.`);
	} else if (!stat.isDirectory()) {
		throw new Error(`${directory} must resolve to a directory.`);
	}
}

function createDirectory(directory: string): void {
	try {
		mkdirSync(directory, { recursive: false });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	}
}
