import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { formatTokens } from "./format.js";
import type { UsageSummary } from "./usage.js";

export interface FooterView {
	cwd: string;
	home?: string;
	branch: string | null;
	sessionName?: string;
	usage: UsageSummary;
	contextPercent: number | null | undefined;
	contextWindow: number;
	model: ExtensionContext["model"];
	thinkingLevel: string;
	providerCount: number;
	statuses: ReadonlyMap<string, string>;
}

function singleLine(text: string): string {
	return text
		.replace(/[\r\n\t]/g, " ")
		.replace(/ +/g, " ")
		.trim();
}

function abbreviateHome(cwd: string, home?: string): string {
	if (!home) return cwd;
	const path = relative(resolve(home), resolve(cwd));
	if (isAbsolute(path) || path === ".." || path.startsWith(`..${sep}`))
		return cwd;
	return path ? `~${sep}${path}` : "~";
}

export function renderFooter(
	view: FooterView,
	theme: Pick<Theme, "fg">,
	width: number,
): string[] {
	if (width <= 0) return ["", ""];

	const color = (
		role: "accent" | "success" | "text" | "muted" | "warning" | "error",
		s: string,
	) => theme.fg(role, s.replace(/[\r\n\t]/g, " "));

	const clip = (s: string, n = width) => truncateToWidth(s, Math.max(0, n), "");

	const cwd = abbreviateHome(view.cwd, view.home);
	const branch = view.branch;
	const name = view.sessionName;
	const first =
		color("accent", `📁 ${cwd}`) +
		(branch ? color("success", ` (🌿 ${branch})`) : "") +
		(name ? color("muted", ` • 🏷️ ${name}`) : "");

	const left = clip(usageText(view, color));
	let right = color("accent", `🤖 ${view.model?.id || "no-model"}`);
	if (view.model?.reasoning)
		right += color(
			"muted",
			` • 🧠 ${view.thinkingLevel === "off" ? "thinking off" : view.thinkingLevel}`,
		);
	const provider =
		view.model && view.providerCount > 1
			? color("muted", `(${view.model.provider}) `)
			: "";
	if (visibleWidth(left) + 2 + visibleWidth(provider + right) <= width)
		right = provider + right;
	right = clip(right, width - visibleWidth(left) - 2);
	const rows = [
		clip(first),
		left +
			(right
				? " ".repeat(
						Math.max(2, width - visibleWidth(left) - visibleWidth(right)),
					) + right
				: ""),
	];
	const statuses = [...view.statuses].sort(([a], [b]) => a.localeCompare(b));
	if (statuses.length)
		rows.push(clip(statuses.map(([, text]) => singleLine(text)).join(" ")));
	return rows;
}

type Color = (
	role: "accent" | "success" | "text" | "muted" | "warning" | "error",
	text: string,
) => string;

function usageText(view: FooterView, color: Color): string {
	const { totals, hit } = view.usage;
	const parts: string[] = [];
	for (const [label, value] of [
		["↑", totals.input],
		["↓", totals.output],
		["R", totals.cacheRead],
		["W", totals.cacheWrite],
	] as const)
		if (value) parts.push(color("text", `${label}${formatTokens(value)}`));
	if ((totals.cacheRead || totals.cacheWrite) && hit !== undefined)
		parts.push(color("text", `CH${hit.toFixed(1)}%`));
	if (totals.cost) parts.push(color("text", `💰 $${totals.cost.toFixed(3)}`));
	const percent = view.contextPercent;
	parts.push(
		color(
			percent != null && percent > 90
				? "error"
				: percent != null && percent > 70
					? "warning"
					: "text",
			`📊 ${percent == null ? "?" : `${percent.toFixed(1)}%`}/${formatTokens(view.contextWindow)}`,
		),
	);
	return parts.join(" ");
}
