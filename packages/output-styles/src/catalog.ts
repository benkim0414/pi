import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import {
	errorMessage,
	projectRoots,
	readRegularFile,
	styleDirectory,
} from "./files.js";
import { builtInStyles, type Style, styleKey } from "./styles.js";

export interface Snapshot {
	styles: Style[];
	roots: string[];
	diagnostics: string[];
}

export function parseStyle(
	content: string,
	path: string,
	project: boolean,
): {
	style?: Style;
	diagnostics: string[];
} {
	const diagnostics: string[] = [];
	let name = basename(path, ".md");
	let description = "";
	let body = content;
	try {
		const parsed = parseFrontmatter(content);
		body = parsed.body;
		const metadata: unknown = parsed.frontmatter;
		if (
			typeof metadata !== "object" ||
			metadata === null ||
			Array.isArray(metadata)
		) {
			throw new Error("Frontmatter must be a mapping.");
		}
		const fields = metadata as Record<string, unknown>;
		if (typeof fields.name === "string" && fields.name.trim())
			name = fields.name.trim();
		if (typeof fields.description === "string")
			description = fields.description.trim();
	} catch (error) {
		// Strip the malformed metadata without asking the YAML parser to parse it again.
		const normalized = content.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
		const match = /^---[^\n]*\n[\s\S]*?\n---[^\n]*(?:\n|$)/.exec(normalized);
		body = match ? normalized.slice(match[0].length) : normalized;
		diagnostics.push(
			`${path}: invalid frontmatter (${errorMessage(error)}). Using filename and body; repair the metadata and /reload.`,
		);
	}
	if (!body.trim()) {
		diagnostics.push(
			`${path}: empty style body. Add instructions and /reload.`,
		);
		return { diagnostics };
	}
	if (styleKey(name) === "default") {
		diagnostics.push(
			`${path}: Default is reserved. Rename the style and /reload.`,
		);
		return { diagnostics };
	}
	return {
		style: {
			name,
			description,
			instructions: body.trim(),
			source: path,
			project,
		},
		diagnostics,
	};
}

export function loadSnapshot(
	cwd: string,
	agentDir: string,
	trusted: boolean,
): Snapshot {
	const diagnostics: string[] = [];
	let roots: string[] = [];
	if (trusted) {
		try {
			roots = projectRoots(cwd);
		} catch (error) {
			diagnostics.push(
				`Cannot locate project styles: ${errorMessage(error)}. Check directory access and /reload.`,
			);
		}
	}
	const styles = new Map<string, Style>();
	for (const scope of [
		...roots.map((root) => ({ root, project: true })),
		{ root: agentDir, project: false },
	]) {
		discoverStyles(scope, styles, diagnostics);
	}
	for (const style of builtInStyles) {
		if (!styles.has(styleKey(style.name)))
			styles.set(styleKey(style.name), style);
	}
	return { styles: [...styles.values()], roots, diagnostics };
}

function discoverStyles(
	scope: { root: string; project: boolean },
	styles: Map<string, Style>,
	diagnostics: string[],
): void {
	try {
		const directory = styleDirectory(scope.root, scope.project);
		if (!directory) return;
		const entries = readdirSync(directory, { withFileTypes: true }).sort(
			(a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
		);
		for (const entry of entries) {
			if (!entry.name.endsWith(".md")) continue;
			if (!entry.isFile() && !entry.isSymbolicLink()) continue;
			const path = join(directory, entry.name);
			collectStyle(path, scope.project, styles, diagnostics);
		}
	} catch (error) {
		diagnostics.push(
			`Cannot discover styles under ${scope.root}: ${errorMessage(error)}. Repair access and /reload.`,
		);
	}
}

function collectStyle(
	path: string,
	project: boolean,
	styles: Map<string, Style>,
	diagnostics: string[],
): void {
	try {
		const parsed = parseStyle(readRegularFile(path), path, project);
		diagnostics.push(...parsed.diagnostics);
		if (!parsed.style) return;
		const key = styleKey(parsed.style.name);
		const winner = styles.get(key);
		if (winner) {
			diagnostics.push(
				`${path}: style "${parsed.style.name}" is shadowed by ${winner.source}. Rename it to select it separately.`,
			);
		} else {
			styles.set(key, parsed.style);
		}
	} catch (error) {
		diagnostics.push(
			`${path}: ${errorMessage(error)}. Repair access and /reload.`,
		);
	}
}
