import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSnapshot, parseStyle } from "../src/catalog.js";
import { projectRoots } from "../src/files.js";
import { file, fixture } from "./fixtures.js";

const { readFile, beforeStat } = vi.hoisted(() => ({
	readFile: vi.fn(),
	beforeStat: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:fs")>();
	return {
		...original,
		lstatSync: (...args: unknown[]) => {
			beforeStat(...args);
			return Reflect.apply(original.lstatSync, original, args);
		},
		readFileSync: (...args: unknown[]) => {
			readFile(...args);
			return Reflect.apply(original.readFileSync, original, args);
		},
	};
});

beforeEach(() => {
	readFile.mockReset();
	beforeStat.mockReset();
});

describe("style parsing", () => {
	it("supports Markdown with optional metadata and ignores behavior-control fields", () => {
		const parsed = parseStyle(
			"---\nname: Diagrams first\ndescription: Show structure\nkeep-coding-instructions: false\nforce-for-plugin: true\n---\nDraw a diagram.",
			"/styles/diagrams.md",
			true,
		);

		expect(parsed.diagnostics).toEqual([]);
		expect(parsed.style).toEqual({
			name: "Diagrams first",
			description: "Show structure",
			instructions: "Draw a diagram.",
			source: "/styles/diagrams.md",
			project: true,
		});
	});

	it("uses the filename for plain Markdown", () => {
		const content = "Plain instructions.";

		const parsed = parseStyle(content, "/styles/plain.md", false);

		expect(parsed.style?.name).toBe("plain");
	});

	it.each(["name: [broken", "- a\n- b"])(
		"falls back to filename and body for invalid metadata %s",
		(yaml) => {
			const parsed = parseStyle(
				`---\n${yaml}\n---\nKeep this body.`,
				"/styles/fallback.md",
				false,
			);

			expect(parsed.style).toMatchObject({
				name: "fallback",
				instructions: "Keep this body.",
			});
			expect(parsed.diagnostics.join(" ")).toContain("/reload");
		},
	);

	it.each([
		["empty", "---\nname: Empty\n---\n"],
		["reserved", "---\nname: dEfAuLt\n---\nOverride"],
	])("rejects %s styles", (_kind, content) => {
		const parsed = parseStyle(content, "/styles/example.md", true);

		expect(parsed.style).toBeUndefined();
	});
});

describe("discovery", () => {
	it.each([
		[
			"ASD-STE100",
			"Practical Simplified Technical English for clear technical answers",
		],
		["ELI5", "keep it simple pls"],
	])(
		"bundles %s while allowing personal and trusted project overrides",
		(name, description) => {
			const { cwd, agentDir } = fixture();

			const lookup = (trusted: boolean) =>
				loadSnapshot(cwd, agentDir, trusted).styles.filter(
					(style) => style.name.toLowerCase() === name.toLowerCase(),
				);

			expect(lookup(false)).toEqual([
				expect.objectContaining({
					name,
					description,
					source: "built-in",
					project: false,
				}),
			]);

			file(
				join(agentDir, "output-styles", "personal.md"),
				`---\nname: ${name}\n---\nPersonal override`,
			);
			file(
				join(cwd, ".pi", "output-styles", "project.md"),
				`---\nname: ${name.toLowerCase()}\n---\nProject override`,
			);

			expect(lookup(false)).toEqual([
				expect.objectContaining({
					instructions: "Personal override",
					project: false,
				}),
			]);
			expect(lookup(true)).toEqual([
				expect.objectContaining({
					instructions: "Project override",
					project: true,
				}),
			]);
		},
	);

	it("reports unreadable files without preventing built-in or other custom styles", () => {
		const { cwd, agentDir } = fixture();
		const path = file(
			join(cwd, ".pi", "output-styles", "unreadable.md"),
			"Unavailable",
		);
		file(join(cwd, ".pi", "output-styles", "readable.md"), "Available");

		readFile.mockImplementation((input) => {
			if (input === path)
				throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
		});

		const snapshot = loadSnapshot(cwd, agentDir, true);

		expect(snapshot.styles.some((style) => style.name === "unreadable")).toBe(
			false,
		);
		expect(snapshot.styles.some((style) => style.name === "readable")).toBe(
			true,
		);
		expect(snapshot.styles.some((style) => style.name === "Concise")).toBe(
			true,
		);
		expect(snapshot.diagnostics.join(" ")).toContain("Permission denied");
		expect(snapshot.diagnostics.join(" ")).toContain("/reload");
	});

	it("finds Git worktree roots and limits non-Git projects to cwd", () => {
		const { cwd } = fixture();

		// The test host may itself expose a Git marker above the temporary fixture.
		beforeStat.mockImplementation((path) => {
			if (
				String(path).endsWith("/.git") &&
				!String(path).startsWith(`${cwd}/`)
			) {
				throw Object.assign(new Error("No Git marker outside the fixture"), {
					code: "ENOENT",
				});
			}
		});

		const nested = join(cwd, "src", "feature");
		mkdirSync(nested, { recursive: true });

		expect(projectRoots(nested)).toEqual([nested]);

		file(join(cwd, ".git"), "gitdir: /unused/metadata");

		expect(projectRoots(nested)).toEqual([nested, join(cwd, "src"), cwd]);
	});

	it("resolves nearest project, user, and built-in styles deterministically", () => {
		const { cwd, agentDir } = fixture();
		mkdirSync(join(cwd, ".git"));
		const nested = join(cwd, "nested");
		mkdirSync(nested);
		file(
			join(agentDir, "output-styles", "user.md"),
			"---\nname: Shared\n---\nUser",
		);
		file(
			join(cwd, ".pi", "output-styles", "root.md"),
			"---\nname: Shared\n---\nRoot",
		);
		file(
			join(nested, ".pi", "output-styles", "a.md"),
			"---\nname: shared\n---\nNearest",
		);
		file(
			join(nested, ".pi", "output-styles", "z.md"),
			"---\nname: SHARED\n---\nDuplicate",
		);
		file(
			join(agentDir, "output-styles", "concise.md"),
			"---\nname: Concise\n---\nCustom concise",
		);
		const snapshot = loadSnapshot(nested, agentDir, true);

		expect(
			snapshot.styles.filter((s) => s.name.toLowerCase() === "shared"),
		).toHaveLength(1);
		expect(snapshot.styles.find((s) => s.name === "shared")?.instructions).toBe(
			"Nearest",
		);
		expect(
			snapshot.styles.find((s) => s.name === "Concise")?.instructions,
		).toBe("Custom concise");
		expect(snapshot.styles.find((s) => s.name === "Learning")?.source).toBe(
			"built-in",
		);
		expect(
			snapshot.diagnostics.filter((d) => d.includes("shadowed")),
		).toHaveLength(3);
	});

	it("does not read project files before trust or follow nested directories", () => {
		const { cwd, agentDir, root } = fixture();
		file(
			join(cwd, ".pi", "output-styles", "secret.md"),
			"Project instructions",
		);
		file(join(agentDir, "output-styles", "nested", "hidden.md"), "Nested");
		const personal = file(
			join(agentDir, "output-styles", "personal.md"),
			"Personal",
		);
		const target = file(
			join(root, "external.md"),
			"Personal linked instructions",
		);
		symlinkSync(target, join(agentDir, "output-styles", "linked.md"));
		readFile.mockClear();
		const snapshot = loadSnapshot(cwd, agentDir, false);

		expect(snapshot.roots).toEqual([]);
		expect(
			snapshot.styles
				.filter((s) => s.source !== "built-in")
				.map((s) => s.source),
		).toEqual([join(agentDir, "output-styles", "linked.md"), personal]);
		expect(
			readFile.mock.calls.some(([path]) => String(path).startsWith(cwd)),
		).toBe(false);
	});

	it.each([".pi", ".pi/output-styles"])(
		"loads styles through a symlinked directory at %s",
		(part) => {
			const { cwd, agentDir, root } = fixture();
			const outside = join(root, "outside");
			mkdirSync(outside);
			file(
				join(outside, part === ".pi" ? "output-styles/secret.md" : "secret.md"),
				"Linked instructions",
			);
			if (part.includes("/")) mkdirSync(join(cwd, ".pi"));
			symlinkSync(outside, join(cwd, part));
			const snapshot = loadSnapshot(cwd, agentDir, true);

			expect(snapshot.styles.find((s) => s.name === "secret")?.project).toBe(
				true,
			);
			expect(snapshot.diagnostics).toEqual([]);
		},
	);
});

describe("symlinks", () => {
	it("loads a symlinked directory and Markdown files", () => {
		const { cwd, agentDir, root } = fixture();
		const directory = join(root, "dotfiles", "styles");
		file(join(directory, "regular.md"), "Regular instructions");
		const target = file(join(root, "linked.md"), "Linked instructions");
		symlinkSync(target, join(directory, "linked.md"));
		symlinkSync(directory, join(agentDir, "output-styles"));
		const snapshot = loadSnapshot(cwd, agentDir, false);

		expect(snapshot.diagnostics).toEqual([]);
		expect(
			snapshot.styles.find((style) => style.name === "regular")?.instructions,
		).toBe("Regular instructions");
		expect(
			snapshot.styles.find((style) => style.name === "linked")?.instructions,
		).toBe("Linked instructions");
	});

	it("reports broken symlinks and symlinks to directories without losing other styles", () => {
		const { cwd, agentDir, root } = fixture();
		file(join(agentDir, "output-styles", "valid.md"), "Valid");
		symlinkSync(
			join(root, "missing"),
			join(agentDir, "output-styles", "broken.md"),
		);
		symlinkSync(root, join(agentDir, "output-styles", "directory.md"));
		const snapshot = loadSnapshot(cwd, agentDir, false);

		expect(
			snapshot.styles.find((style) => style.name === "valid"),
		).toBeDefined();
		expect(
			snapshot.styles.find((style) => style.name === "broken"),
		).toBeUndefined();
		expect(
			snapshot.styles.find((style) => style.name === "directory"),
		).toBeUndefined();
		expect(snapshot.diagnostics).toHaveLength(2);
	});

	it("reports a broken directory symlink", () => {
		const { cwd, agentDir, root } = fixture();
		symlinkSync(join(root, "missing"), join(agentDir, "output-styles"));

		const snapshot = loadSnapshot(cwd, agentDir, false).diagnostics.join(" ");

		expect(snapshot).toContain("cannot read directory symlink");
	});

	it("loads symlinked style files", () => {
		const { cwd, agentDir, root } = fixture();
		const target = file(join(root, "outside.md"), "Outside instructions");
		file(join(cwd, ".pi", "output-styles", "regular.md"), "Regular");
		symlinkSync(target, join(cwd, ".pi", "output-styles", "linked.md"));
		const snapshot = loadSnapshot(cwd, agentDir, true);

		expect(
			snapshot.styles.find((style) => style.name === "linked")?.instructions,
		).toBe("Outside instructions");
		expect(
			snapshot.styles.find((style) => style.name === "regular"),
		).toBeDefined();
	});
});
