import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Config } from "./config.js";

export async function requestAuxiliary(
	context: ExtensionContext,
	config: Config,
	system: string,
	text: string,
	signal: AbortSignal,
): Promise<string> {
	const model =
		config.provider && config.model
			? context.modelRegistry.find(config.provider, config.model)
			: context.model;
	if (!model) throw new Error("No auxiliary model available.");
	const result = await context.modelRegistry
		.streamSimple(
			model,
			{
				systemPrompt: system,
				messages: [{ role: "user", content: text, timestamp: Date.now() }],
			},
			{ maxTokens: 4096, signal },
		)
		.result();
	if (result.stopReason === "error" || result.stopReason === "aborted")
		throw new Error(result.errorMessage || "Auxiliary request failed.");
	return result.content
		.filter((p) => p.type === "text")
		.map((p) => p.text)
		.join("\n");
}
