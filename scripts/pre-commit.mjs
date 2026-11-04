import { execFileSync, spawnSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

const staged = git(
	"diff",
	"--cached",
	"--name-only",
	"--diff-filter=ACMR",
	"-z",
)
	.split("\0")
	.filter(Boolean);
const supported = staged.filter((file) =>
	/\.(?:[cm]?[jt]sx?|jsonc?)$/.test(file),
);
// Whole-file fixes must not include edits the user deliberately left unstaged.
for (const file of supported) {
	const result = spawnSync("git", ["diff", "--quiet", "--", file]);
	if (result.status !== 0) {
		console.error(
			`Cannot auto-fix partially staged file: ${file}. Stage its remaining edits or commit it separately.`,
		);
		process.exit(1);
	}
}

function run(args) {
	const result = spawnSync("npm", args, { stdio: "inherit" });
	if (result.error) console.error(result.error.message);
	if (result.status !== 0) process.exit(result.status ?? 1);
}

if (supported.length) {
	console.log("Applying Biome fixes and formatting to staged files...");
	run([
		"exec",
		"--",
		"biome",
		"check",
		"--write",
		"--error-on-warnings",
		"--",
		...supported,
	]);
}
console.log("Running workspace checks...");
run(["run", "check"]);
// Git receives distinct arguments, preserving spaces and other special characters.
if (supported.length) git("add", "--", ...supported);
console.log("All pre-commit checks passed.");
