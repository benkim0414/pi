import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { checkTestSource } from "./test-conventions.mjs";

describe("test conventions", () => {
	it("rejects test aliases and parameterized registrations", () => {
		const source = `import { test as check } from "vitest"; check.each([1])("returns %s", () => {});`;

		const diagnostics = checkTestSource(source);

		assert.equal(diagnostics.length, 1);
		assert.match(diagnostics[0], /Use Vitest it/);
	});

	it("rejects should in namespace and conditional registrations", () => {
		const source = `import * as v from "vitest"; v.it.skipIf(false)("should return a value", () => {});`;

		const diagnostics = checkTestSource(source);

		assert.equal(diagnostics.length, 1);
		assert.match(diagnostics[0], /without should/);
	});

	it("accepts it modifiers and parameterized titles", () => {
		const source = `import { it as check } from "vitest"; check.each([1])("returns %s", () => {}); check.runIf(true)("returns a value", () => {}); check.only("returns a value", () => {});`;

		const diagnostics = checkTestSource(source);

		assert.deepEqual(diagnostics, []);
	});

	it("ignores unrelated test methods and strings", () => {
		const source = `const message = "should"; /pattern/.test(message); service.test("should", () => {});`;

		const diagnostics = checkTestSource(source);

		assert.deepEqual(diagnostics, []);
	});
});

describe("registration syntax", () => {
	for (const extension of ["tsx", "jsx"]) {
		it(`ignores registration-like JSX text in ${extension} files`, () => {
			const source =
				'import { it } from "vitest"; const view = <div>it("should render", handler)</div>;';

			const diagnostics = checkTestSource(source, `view.test.${extension}`);

			assert.deepEqual(diagnostics, []);
		});

		it(`checks real registrations in ${extension} files`, () => {
			const source =
				'import { it } from "vitest"; const view = <div />; it("should render", () => {}); it("renders view", () => {});';

			const diagnostics = checkTestSource(source, `view.test.${extension}`);

			assert.equal(diagnostics.length, 1);
			assert.match(diagnostics[0], /without should/);
		});
	}
	for (const [title, source, count] of [
		[
			"rejects direct registrations",
			'import { test } from "vitest"; test("returns a value", () => {});',
			1,
		],
		[
			"rejects namespace test modifiers",
			'import * as v from "vitest"; v.test.concurrent.only("returns a value", () => {});',
			1,
		],
		[
			"rejects tagged parameterized tests",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: This parser fixture intentionally contains interpolation syntax.
			'import { test } from "vitest"; test.each`value\n${1}`("returns $value", () => {});',
			1,
		],
		[
			"rejects case insensitive should titles",
			'import { it } from "vitest"; it("Should return", () => {});',
			1,
		],
		[
			"decodes escaped title text",
			'import { it } from "vitest"; it("sh\\u006fuld return", () => {});',
			1,
		],
		[
			"accepts shadowed local functions",
			'import { test } from "vitest"; function other(test: Function) { test("should", () => {}); }',
			0,
		],
		[
			"accepts unrelated imports",
			'import { test } from "another-library"; test("should", () => {});',
			0,
		],
		[
			"ignores interpolation expressions",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: This parser fixture intentionally contains interpolation syntax.
			'import { it } from "vitest"; it(`returns ${should}`, () => {});',
			0,
		],
		[
			"accepts conditional it registrations",
			'import { it } from "vitest"; it.skipIf(true).each([1])("returns %s", () => {});',
			0,
		],
		[
			"accepts titles with should as part of a word",
			'import { it } from "vitest"; it("renders shoulders", () => {});',
			0,
		],
	]) {
		it(title, () => {
			const diagnostics = checkTestSource(source);

			assert.equal(diagnostics.length, count);
		});
	}
});

describe("command line enforcement", () => {
	for (const [kind, source, expectedStatus] of [
		[
			"violating",
			'import { test } from "vitest"; test("should parse", () => {});',
			1,
		],
		["safe", 'import { it } from "vitest"; it("parses input", () => {});', 0],
		["unrelated", '/pattern/.test("should");', 0],
	]) {
		it(`reports the exit status for a ${kind} file`, () => {
			const directory = mkdtempSync(join(tmpdir(), "pi-test-conventions-cli-"));
			try {
				writeFileSync(join(directory, "example.test.ts"), source);
				const environment = { ...process.env };
				delete environment.NODE_TEST_CONTEXT;
				const script = fileURLToPath(
					new URL("./test-conventions.mjs", import.meta.url),
				);

				const result = spawnSync(process.execPath, [script, directory], {
					encoding: "utf8",
					env: environment,
				});

				assert.ifError(result.error);
				assert.equal(result.status, expectedStatus, result.stderr);
				if (expectedStatus === 1)
					assert.match(result.stderr, /example\.test\.ts:1:/);
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		});
	}
});
