import { expect, it } from "vitest";
import { formatTokens } from "../src/index.js";

it.each([
	[0, "0"],
	[999, "999"],
	[1000, "1.0k"],
	[9999, "10.0k"],
	[10000, "10k"],
	[999999, "1000k"],
	[1000000, "1.0M"],
	[10000000, "10M"],
])("formats %s like the default footer", (value, expected) => {
	const tokens = formatTokens(Number(value));

	expect(tokens).toBe(expected);
});
