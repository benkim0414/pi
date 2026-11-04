import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { UsageCache } from "../src/usage.js";

function entry(input: number): SessionEntry {
	return {
		type: "usage",
		id: "usage",
		parentId: null,
		timestamp: "2026-11-03T00:00:00Z",
		kind: "test",
		provider: "fake",
		model: "fake",
		usage: {
			input,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: input,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
	};
}

function cacheFixture() {
	let entries = [entry(10)];
	let sessionId = "one";
	let leafId = "leaf-one";
	const session = {
		getEntries: () => entries,
		getSessionId: () => sessionId,
		getLeafId: () => leafId,
	};
	const cache = new UsageCache();
	const initial = cache.read(session);
	return {
		cache,
		session,
		initial,
		replaceEntries: (values: number[]) => {
			entries = values.map(entry);
		},
		changeSession: () => {
			sessionId = "two";
		},
		changeLeaf: () => {
			leafId = "leaf-two";
		},
	};
}

describe("footer usage cache", () => {
	it("aggregates initial usage", () => {
		const { initial } = cacheFixture();

		expect(initial.totals.input).toBe(10);
	});

	it("reuses aggregation while the cache key stays unchanged", () => {
		const { cache, session, initial, replaceEntries } = cacheFixture();
		replaceEntries([20]);

		const cached = cache.read(session);

		expect(cached).toBe(initial);
	});

	it.each(["leaf", "session", "length", "invalidation"])(
		"refreshes aggregation after %s changes",
		(change) => {
			const state = cacheFixture();
			state.replaceEntries(change === "length" ? [20, 30] : [20]);
			if (change === "leaf") state.changeLeaf();
			if (change === "session") state.changeSession();
			if (change === "invalidation") state.cache.invalidate();

			const refreshed = state.cache.read(state.session);

			expect(refreshed).not.toBe(state.initial);
			expect(refreshed.totals.input).toBe(change === "length" ? 50 : 20);
		},
	);
});
