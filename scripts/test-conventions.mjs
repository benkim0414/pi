import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as ts from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

const testFunctions = new Set(["it", "test"]);
const modifierFactories = new Set(["each", "skipIf", "runIf", "extend"]);

// TypeScript 7 exposes parsed trees through a compiler session, rather than createSourceFile.
export function checkTestSource(source, filename = "example.test.ts") {
	const directory = mkdtempSync(join(tmpdir(), "pi-test-conventions-"));
	let api;
	try {
		const path = join(directory, `example.test${extname(filename) || ".ts"}`);
		writeFileSync(path, source);
		api = new API();
		const snapshot = api.updateSnapshot({ openFiles: [path] });
		const project = snapshot.getDefaultProjectForFile(path);
		return checkTree(
			project.program.getSourceFile(path),
			project.checker,
			filename,
		);
	} finally {
		api?.close();
		rmSync(directory, { recursive: true, force: true });
	}
}

function vitestBindings(file, symbolId) {
	const bindings = new Map();
	for (const statement of file.statements) {
		if (
			!ts.isImportDeclaration(statement) ||
			statement.moduleSpecifier.text !== "vitest"
		)
			continue;
		const imports = statement.importClause?.namedBindings;
		if (!imports) continue;
		if (ts.isNamespaceImport(imports)) {
			bindings.set(symbolId(imports.name), "namespace");
			continue;
		}
		for (const binding of imports.elements) {
			const name = (binding.propertyName ?? binding.name).text;
			if (testFunctions.has(name)) bindings.set(symbolId(binding.name), name);
		}
	}
	return bindings;
}

function registration(expression, bindings, symbolId) {
	if (ts.isIdentifier(expression)) return bindings.get(symbolId(expression));
	if (ts.isCallExpression(expression))
		return registration(expression.expression, bindings, symbolId);
	if (ts.isTaggedTemplateExpression(expression))
		return registration(expression.tag, bindings, symbolId);
	if (!ts.isPropertyAccessExpression(expression)) return undefined;
	const parent = registration(expression.expression, bindings, symbolId);
	if (parent !== "namespace") return parent;
	return testFunctions.has(expression.name.text)
		? expression.name.text
		: undefined;
}

function titleContainsShould(title) {
	if (!title) return false;
	if (ts.isStringLiteral(title) || ts.isNoSubstitutionTemplateLiteral(title))
		return /\bshould\b/i.test(title.text);
	if (!ts.isTemplateExpression(title)) return false;
	// Check literal text only: interpolated data may legitimately contain the word.
	return [
		title.head.text,
		...title.templateSpans.map((span) => span.literal.text),
	].some((text) => /\bshould\b/i.test(text));
}

function checkTree(file, checker, filename) {
	const symbolId = (node) => checker.getSymbolAtLocation(node)?.id;

	const bindings = vitestBindings(file, symbolId);
	const diagnostics = [];

	function report(node, message) {
		const { line, character } = file.getLineAndCharacterOfPosition(
			node.getStart(file),
		);
		diagnostics.push(`${filename}:${line + 1}:${character + 1}: ${message}`);
	}

	function checkCall(node) {
		const kind = registration(node.expression, bindings, symbolId);
		if (!testFunctions.has(kind)) return;
		// each(rows), skipIf(condition), and similar calls create a registration function.
		if (
			ts.isPropertyAccessExpression(node.expression) &&
			modifierFactories.has(node.expression.name.text)
		)
			return;
		if (kind === "test") report(node, "Use Vitest it instead of test.");
		if (titleContainsShould(node.arguments[0]))
			report(
				node.arguments[0],
				"Describe behavior in present tense without should.",
			);
	}

	function visit(node) {
		if (ts.isCallExpression(node)) checkCall(node);
		node.forEachChild(visit);
	}

	visit(file);
	return diagnostics;
}

function testFiles(directory) {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return testFiles(path);
		return /\.(test|spec)\.[cm]?[jt]sx?$/.test(entry.name) ? [path] : [];
	});
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	const diagnostics = process.argv
		.slice(2)
		.flatMap(testFiles)
		.flatMap((path) => checkTestSource(readFileSync(path, "utf8"), path));
	for (const diagnostic of diagnostics) console.error(diagnostic);
	if (diagnostics.length) process.exitCode = 1;
}
