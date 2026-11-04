import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { renderFooter } from "./render.js";
import { UsageCache } from "./usage.js";

type FooterFactory = NonNullable<
	Parameters<ExtensionContext["ui"]["setFooter"]>[0]
>;

export function createFooterFactory(
	pi: ExtensionAPI,
	context: ExtensionContext,
): FooterFactory {
	return (tui, theme, data) => {
		const unsubscribe = data.onBranchChange(() => tui.requestRender());
		const usage = new UsageCache();
		return {
			dispose: unsubscribe,
			invalidate: () => usage.invalidate(),
			render(width) {
				if (width <= 0) return ["", ""];
				const summary = usage.read(context.sessionManager);
				const contextUsage = context.getContextUsage();
				return renderFooter(
					{
						cwd: context.sessionManager.getCwd(),
						home: process.env.HOME || process.env.USERPROFILE,
						branch: data.getGitBranch(),
						sessionName: context.sessionManager.getSessionName(),
						usage: summary,
						contextPercent: contextUsage?.percent,
						contextWindow:
							contextUsage?.contextWindow ?? context.model?.contextWindow ?? 0,
						model: context.model,
						thinkingLevel: context.model?.reasoning
							? pi.getThinkingLevel()
							: "off",
						providerCount: context.model ? data.getAvailableProviderCount() : 0,
						statuses: data.getExtensionStatuses(),
					},
					theme,
					width,
				);
			},
		};
	};
}
