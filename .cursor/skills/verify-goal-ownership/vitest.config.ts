import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["repro-wait-miss.test.ts"],
		environment: "node",
	},
});
