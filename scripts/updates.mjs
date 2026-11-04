export const allowedTools = new Set(["typescript", "vitest"]);
export function eligibleUpdate(names, type, ecosystem) {
	return (
		["npm", "npm_and_yarn"].includes(ecosystem) &&
		type === "version-update:semver-patch" &&
		names.length > 0 &&
		names.every((n) => allowedTools.has(n))
	);
}
