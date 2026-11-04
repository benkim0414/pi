import {
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSelection, saveSelection } from "../src/settings.js";
import { file, fixture, settings } from "./fixtures.js";

const { beforeWrite } = vi.hoisted(() => ({ beforeWrite: vi.fn() }));

vi.mock("node:fs", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:fs")>();
	return {
		...original,
		writeFileSync: (...args: unknown[]) => {
			beforeWrite(...args);
			return Reflect.apply(original.writeFileSync, original, args);
		},
	};
});

beforeEach(() => beforeWrite.mockReset());

describe("selection settings", () => {
	it("keeps the old selection and removes its temporary file when a disk write fails", () => {
		const { cwd } = fixture();
		const path = settings(
			cwd,
			{ outputStyle: "Concise", other: true },
			true,
			true,
		);

		beforeWrite.mockImplementation((descriptor) => {
			if (typeof descriptor === "number") throw new Error("Disk full");
		});

		expect(() => saveSelection(cwd, "Learning")).toThrow("Disk full");
		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
			outputStyle: "Concise",
			other: true,
		});
		expect(readdirSync(join(cwd, ".pi", "output-styles"))).toEqual([
			"settings.local.json",
		]);
	});

	it.each([
		["nearest shared", false, false, "Proactive"],
		["ancestor local", true, false, "Concise"],
		["nearest local", true, true, "Default"],
	] as const)(
		"uses %s settings ahead of lower precedence sources",
		(_scope, ancestorLocal, nearestLocal, expected) => {
			const { cwd, agentDir } = fixture();
			const nested = join(cwd, "nested");
			mkdirSync(nested);
			settings(agentDir, { outputStyle: "Learning" }, false);
			settings(cwd, { outputStyle: "Explanatory" });
			settings(nested, { outputStyle: "Proactive" });
			if (ancestorLocal) settings(cwd, { outputStyle: "Concise" }, true, true);
			if (nearestLocal)
				settings(nested, { outputStyle: "Default" }, true, true);

			const selection = loadSelection([nested, cwd], agentDir);

			expect(selection.name).toBe(expected);
		},
	);

	it("uses personal settings without project roots", () => {
		const { agentDir } = fixture();
		settings(agentDir, { outputStyle: "Learning" }, false);

		const selection = loadSelection([], agentDir);

		expect(selection.name).toBe("Learning");
	});

	it("skips invalid JSON and wrong types with diagnostics", () => {
		const { cwd, agentDir } = fixture();
		file(join(cwd, ".pi", "output-styles", "settings.local.json"), "{broken");
		settings(cwd, { outputStyle: 42 });
		settings(agentDir, { outputStyle: "Concise" }, false);
		const result = loadSelection([cwd], agentDir);

		expect(result.name).toBe("Concise");
		expect(result.diagnostics).toHaveLength(2);
	});

	it("saves canonical selection while preserving unrelated keys and leaves no temporary file", () => {
		const { cwd } = fixture();
		const path = settings(cwd, { other: { value: true } }, true, true);
		saveSelection(cwd, "Explanatory");

		expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
			other: { value: true },
			outputStyle: "Explanatory",
		});
		expect(readdirSync(join(cwd, ".pi", "output-styles"))).toEqual([
			"settings.local.json",
		]);
	});

	it("creates missing directories and keeps Default as an explicit override", () => {
		const { cwd, agentDir } = fixture();
		settings(agentDir, { outputStyle: "Learning" }, false);
		saveSelection(cwd, "Default");

		const selection = loadSelection([cwd], agentDir).name;

		expect(selection).toBe("Default");
	});

	it("does not overwrite invalid settings", () => {
		const { cwd } = fixture();
		const path = file(
			join(cwd, ".pi", "output-styles", "settings.local.json"),
			"invalid JSON",
		);

		expect(() => saveSelection(cwd, "Concise")).toThrow();
		expect(readFileSync(path, "utf8")).toBe("invalid JSON");
	});

	it("saves through settings symlinks without replacing the symlink", () => {
		const { cwd, root } = fixture();
		const target = file(join(root, "outside.json"), '{"other":true}');
		const intermediate = join(root, "intermediate.json");
		symlinkSync(target, intermediate);
		mkdirSync(join(cwd, ".pi", "output-styles"), { recursive: true });
		symlinkSync(
			intermediate,
			join(cwd, ".pi", "output-styles", "settings.local.json"),
		);
		saveSelection(cwd, "Concise");

		expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({
			other: true,
			outputStyle: "Concise",
		});
		expect(lstatSync(intermediate).isSymbolicLink()).toBe(true);
		expect(
			lstatSync(
				join(cwd, ".pi", "output-styles", "settings.local.json"),
			).isSymbolicLink(),
		).toBe(true);
	});
});

describe("settings symlinks", () => {
	it("reads a linked default in a linked personal directory and preserves project precedence", () => {
		const { cwd, agentDir, root } = fixture();
		const directory = join(root, "dotfiles", "styles");
		mkdirSync(directory, { recursive: true });
		const target = file(
			join(root, "defaults.json"),
			'{"outputStyle":"Learning"}',
		);
		symlinkSync(target, join(directory, "settings.json"));
		symlinkSync(directory, join(agentDir, "output-styles"));

		const selection = loadSelection([], agentDir);

		expect(selection).toMatchObject({
			name: "Learning",
			diagnostics: [],
		});

		settings(cwd, { outputStyle: "Concise" });

		const selection2 = loadSelection([cwd], agentDir).name;

		expect(selection2).toBe("Concise");
	});

	it("reports broken settings symlinks", () => {
		const { agentDir, root } = fixture();
		mkdirSync(join(agentDir, "output-styles"));
		symlinkSync(
			join(root, "missing"),
			join(agentDir, "output-styles", "settings.json"),
		);
		const result = loadSelection([], agentDir);

		expect(result.name).toBe("Default");
		expect(result.diagnostics.join(" ")).toContain("cannot read file symlink");
	});

	it("reads symlinked defaults with normal precedence", () => {
		const { cwd, agentDir, root } = fixture();
		settings(agentDir, { outputStyle: "Learning" }, false);
		mkdirSync(join(cwd, ".pi", "output-styles"), { recursive: true });
		const target = file(
			join(root, "outside.json"),
			'{"outputStyle":"Concise"}',
		);
		symlinkSync(target, join(cwd, ".pi", "output-styles", "settings.json"));
		const result = loadSelection([cwd], agentDir);

		expect(result.name).toBe("Concise");
		expect(result.diagnostics).toEqual([]);
	});
});

describe("saving through directory symlinks", () => {
	it.each([".pi", ".pi/output-styles"])("saves through %s", (part) => {
		const { cwd, root } = fixture();
		const directory = join(root, "target");
		mkdirSync(directory);
		if (part.includes("/")) mkdirSync(join(cwd, ".pi"));
		symlinkSync(directory, join(cwd, part));
		saveSelection(cwd, "Concise");
		const target = join(
			directory,
			...(part === ".pi" ? ["output-styles"] : []),
			"settings.local.json",
		);

		expect(JSON.parse(readFileSync(target, "utf8"))).toEqual({
			outputStyle: "Concise",
		});
		expect(lstatSync(join(cwd, part)).isSymbolicLink()).toBe(true);
	});

	it("preserves a broken settings symlink and its missing target", () => {
		const { cwd, root } = fixture();
		mkdirSync(join(cwd, ".pi", "output-styles"), { recursive: true });
		const path = join(cwd, ".pi", "output-styles", "settings.local.json");
		symlinkSync(join(root, "missing.json"), path);

		expect(() => saveSelection(cwd, "Concise")).toThrow(
			/cannot read file symlink/,
		);
		expect(lstatSync(path).isSymbolicLink()).toBe(true);
	});
});
