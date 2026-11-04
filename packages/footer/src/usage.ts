import type {
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";

export interface UsageSummary {
	totals: {
		input: number;
		output: number;
		cacheRead: number;
		cacheWrite: number;
		cost: number;
	};
	hit: number | undefined;
}

function entryUsage(entry: SessionEntry) {
	switch (entry.type) {
		case "message":
			return entry.message.role === "assistant" ||
				entry.message.role === "toolResult"
				? entry.message.usage
				: undefined;
		case "usage":
		case "compaction":
		case "branch_summary":
			return entry.usage;
		default:
			return undefined;
	}
}

export function aggregateUsage(entries: readonly SessionEntry[]): UsageSummary {
	const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
	let hit: number | undefined;
	for (const entry of entries) {
		const usage = entryUsage(entry);
		if (!usage) continue;
		totals.input += usage.input;
		totals.output += usage.output;
		totals.cacheRead += usage.cacheRead;
		totals.cacheWrite += usage.cacheWrite;
		totals.cost += usage.cost.total;
		if (entry.type === "message" && entry.message.role === "assistant") {
			const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
			hit = prompt > 0 ? (usage.cacheRead / prompt) * 100 : undefined;
		}
	}
	return { totals, hit };
}

export class UsageCache {
	private key = "";
	private summary = aggregateUsage([]);

	invalidate(): void {
		this.key = "";
	}

	read(
		session: Pick<
			ExtensionContext["sessionManager"],
			"getEntries" | "getSessionId" | "getLeafId"
		>,
	): UsageSummary {
		const entries = session.getEntries();
		const key = `${session.getSessionId()}:${session.getLeafId()}:${entries.length}`;
		if (key !== this.key) {
			this.summary = aggregateUsage(entries);
			this.key = key;
		}
		return this.summary;
	}
}
