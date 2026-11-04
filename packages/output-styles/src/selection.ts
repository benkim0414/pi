import {
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { loadSnapshot, type Snapshot } from "./catalog.js";
import { errorMessage } from "./files.js";
import { updateStatus } from "./presentation.js";
import { loadSelection, saveSelection } from "./settings.js";
import { defaultStyle, findStyle, type Style, styleKey } from "./styles.js";

interface State {
	cwd: string;
	trusted: boolean;
	snapshot: Snapshot;
	selected: Style;
	requested: string;
}

export class StyleSelection {
	private state: State | undefined;

	clear(): void {
		this.state = undefined;
	}

	initialize(ctx: ExtensionContext): State {
		const trusted = ctx.isProjectTrusted();
		const agentDir = getAgentDir();
		const snapshot = loadSnapshot(ctx.cwd, agentDir, trusted);
		const selection = loadSelection(snapshot.roots, agentDir);
		// Saved names are exact, while commands are case-insensitive.
		const selected =
			snapshot.styles.find((style) => style.name === selection.name) ??
			defaultStyle;
		this.state = {
			cwd: ctx.cwd,
			trusted,
			snapshot,
			selected,
			requested: selection.name,
		};
		for (const diagnostic of [
			...snapshot.diagnostics,
			...selection.diagnostics,
		]) {
			ctx.ui.notify(diagnostic, "warning");
		}
		if (selected.name !== selection.name) {
			ctx.ui.notify(
				`Output style "${selection.name}" from ${selection.source} is unavailable. Using Default; repair the name or file and /reload, or select /output-style default.`,
				"warning",
			);
		}
		updateStatus(ctx, this.state);
		return this.state;
	}

	current(ctx: ExtensionContext): State {
		if (
			!this.state ||
			this.state.cwd !== ctx.cwd ||
			this.state.trusted !== ctx.isProjectTrusted()
		) {
			return this.initialize(ctx);
		}
		return this.state;
	}

	private isCurrent(ctx: ExtensionContext, active: State): boolean {
		return (
			this.state === active &&
			ctx.cwd === active.cwd &&
			ctx.isProjectTrusted() === active.trusted
		);
	}

	private async pick(
		ctx: ExtensionContext,
		active: State,
	): Promise<string | undefined> {
		const styles = active.snapshot.styles;
		const options = styles.map(
			(style) =>
				`${style.name}${style === active.selected ? " (current)" : ""} — ${style.description || "Custom instructions"} [${style.source}]`,
		);
		const picked = await ctx.ui.select(
			`Output style: ${active.selected.name}`,
			options,
		);
		if (picked === undefined) return;
		// A session replacement or trust change invalidates a pending picker.
		if (!this.isCurrent(ctx, active)) {
			ctx.ui.notify(
				"The session or project trust changed. Run /output-style again.",
				"warning",
			);
			return;
		}
		const index = options.indexOf(picked);
		if (index < 0) return;
		return styles[index]?.name;
	}

	complete(prefix: string) {
		const matches = (this.state?.snapshot.styles ?? []).filter((style) =>
			styleKey(style.name).startsWith(styleKey(prefix)),
		);
		return matches.length
			? matches.map((style) => ({
					value: style.name,
					label: style.name,
					description: style.description,
				}))
			: null;
	}

	async select(args: string, ctx: ExtensionContext): Promise<void> {
		if (ctx.mode !== "tui") return;
		const active = this.current(ctx);
		let name = args.trim();
		if (!name) {
			const pickedName = await this.pick(ctx, active);
			if (pickedName === undefined) return;
			name = pickedName;
		}
		const selected = findStyle(active.snapshot.styles, name);
		if (!selected) {
			ctx.ui.notify(
				`Unknown output style "${name}". Run /output-style to list styles, or /reload after adding a file. Selection unchanged.`,
				"error",
			);
			return;
		}
		if (!active.trusted) {
			ctx.ui.notify(
				"Cannot save a project-local output style before Pi grants project trust. Trust the project in Pi and /reload, then select the style again. Selection unchanged.",
				"error",
			);
			return;
		}
		try {
			saveSelection(ctx.cwd, selected.name);
		} catch (error) {
			ctx.ui.notify(
				`Cannot save output style: ${errorMessage(error)}. Repair .pi/output-styles/settings.local.json or directory access and retry. Selection unchanged.`,
				"error",
			);
			return;
		}
		active.selected = selected;
		active.requested = selected.name;
		updateStatus(ctx, active);
		ctx.ui.notify(
			`Output style: ${selected.name}. Saved for this project directory; applies from the next agent run.`,
			"info",
		);
	}
}
