import { readFile } from "node:fs/promises";
import { join } from "node:path";

export interface Config {
	maxTurns: number;
	provider?: string;
	model?: string;
}

export async function loadConfig(
	agentDir: string,
	cwd: string,
	diagnostic: (s: string) => void,
): Promise<Config> {
	const config: Config = { maxTurns: 20 };
	for (const path of [
		join(agentDir, "goal.json"),
		join(cwd, ".pi", "goal.json"),
	]) {
		try {
			const data = JSON.parse(await readFile(path, "utf8"));
			applyConfig(config, data, path, diagnostic);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT")
				diagnostic(`${path}: ${String(error)}`);
		}
	}
	return config;
}

function applyConfig(
	config: Config,
	data: unknown,
	path: string,
	diagnostic: (message: string) => void,
): void {
	if (!data || typeof data !== "object" || Array.isArray(data))
		throw new Error("Expected an object");
	if ("maxTurns" in data && data.maxTurns !== undefined) {
		if (
			typeof data.maxTurns !== "number" ||
			!Number.isSafeInteger(data.maxTurns) ||
			data.maxTurns < 1
		)
			diagnostic(`${path}: maxTurns must be a positive integer.`);
		else config.maxTurns = data.maxTurns;
	}
	if ("judge" in data && data.judge !== undefined) {
		if (isJudgeConfig(data.judge)) {
			config.provider = data.judge.provider;
			config.model = data.judge.model;
		} else diagnostic(`${path}: judge requires provider and model strings.`);
	}
}

function isJudgeConfig(
	value: unknown,
): value is { provider: string; model: string } {
	return (
		value !== null &&
		typeof value === "object" &&
		"provider" in value &&
		typeof value.provider === "string" &&
		value.provider.length > 0 &&
		"model" in value &&
		typeof value.model === "string" &&
		value.model.length > 0
	);
}
