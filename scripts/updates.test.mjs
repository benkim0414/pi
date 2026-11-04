import assert from "node:assert/strict";
import { test } from "node:test";
import { eligibleUpdate } from "./updates.mjs";
test("only allowlisted npm patches qualify", () => {
	assert(
		eligibleUpdate(
			["typescript", "vitest"],
			"version-update:semver-patch",
			"npm_and_yarn",
		),
	);
	for (const names of [
		[],
		[""],
		["vitest", "yaml"],
		["@earendil-works/pi-coding-agent"],
		["actions/checkout"],
	])
		assert(!eligibleUpdate(names, "version-update:semver-patch", "npm"));
	for (const type of [
		"version-update:semver-minor",
		"version-update:semver-major",
	])
		assert(!eligibleUpdate(["vitest"], type, "npm"));
	assert(
		!eligibleUpdate(
			["vitest"],
			"version-update:semver-patch",
			"github-actions",
		),
	);
});
