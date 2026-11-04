import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { Config } from "./config.js";
import { continuation, type Goal, isGoal, pause } from "./domain.js";
import { Processes, pidAlive } from "./processes.js";

export const GOAL_ENTRY = "goal-state";

// Owns session resources and the generations that invalidate asynchronous work.
export class GoalController {
	goal: Goal | undefined;
	context: ExtensionContext | undefined;
	config: Config = { maxTurns: 20 };
	private epoch = 0;
	private human = 0;
	wakePending = false;
	pending: AbortController | undefined;
	unsubscribeInput: (() => void) | undefined;
	private timer: ReturnType<typeof setTimeout> | undefined;
	processes = new Processes(() => this.scheduleWake());

	constructor(
		private readonly pi: Pick<ExtensionAPI, "appendEntry" | "sendUserMessage">,
	) {}

	eligible(context: ExtensionContext): boolean {
		return context.mode === "tui" && context.isProjectTrusted();
	}

	notify(text: string): void {
		this.context?.ui.notify(text, "info");
	}

	restore(context: ExtensionContext): Goal | undefined {
		for (const entry of context.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== GOAL_ENTRY) continue;
			this.goal = isGoal(entry.data) ? structuredClone(entry.data) : undefined;
			if (!this.goal)
				this.notify("Invalid saved goal state; automatic execution disabled.");
		}
		return this.goal;
	}

	captureInput(): () => boolean {
		const epoch = this.epoch;
		const human = this.human;
		return () => this.epoch === epoch && this.human === human;
	}

	evaluationCheckpoint(goal: Goal, context: ExtensionContext) {
		const epoch = this.epoch;
		const revision = goal.revision;
		const inputIsCurrent = this.captureInput();

		const ownsGoal = () => this.goal === goal && this.epoch === epoch;

		return {
			ownsGoal,
			isCurrent: () =>
				ownsGoal() &&
				goal.revision === revision &&
				goal.status === "active" &&
				inputIsCurrent() &&
				!context.hasPendingMessages() &&
				!context.signal?.aborted,
		};
	}

	onHumanInput(): void {
		this.human++;
		this.pending?.abort();
	}

	async dispose(): Promise<void> {
		this.unsubscribeInput?.();
		this.unsubscribeInput = undefined;
		this.invalidate();
		await this.processes.close();
		this.processes = new Processes(() => this.scheduleWake());
		this.context?.ui.setStatus("goal", undefined);
		this.context = undefined;
	}

	save(): void {
		if (this.goal) this.pi.appendEntry(GOAL_ENTRY, structuredClone(this.goal));
		this.context?.ui.setStatus(
			"goal",
			this.goal && this.goal.status !== "cleared"
				? `⊙ ${this.goal.status}${this.goal.wait ? " (waiting)" : ""} ${this.goal.used}/${this.goal.limit}`
				: undefined,
		);
	}

	invalidate(): void {
		this.epoch++;
		this.wakePending = false;
		this.pending?.abort();
		this.pending = undefined;
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}

	async submit(goal: Goal): Promise<void> {
		const ticket = this.epoch;
		try {
			await this.pi.sendUserMessage(continuation(goal), {
				expandPromptTemplates: false,
			});
			if (this.goal === goal && this.epoch === ticket) this.wakePending = false;
		} catch (error) {
			if (this.goal === goal && this.epoch === ticket) {
				this.wakePending = false;
				pause(goal, `Submission failed: ${String(error)}`);
				this.save();
				this.notify(goal.reason);
			}
		}
	}

	requireGoal(): Goal {
		if (!this.goal || !["active", "paused"].includes(this.goal.status))
			throw new Error("No active goal.");
		return this.goal;
	}

	isWaiting(): boolean {
		if (!this.goal?.wait) return false;
		const w = this.goal.wait;
		let held = Date.now() < w.deadline;
		if (w.kind === "pid") held = held && pidAlive(w.pid);
		if (w.kind === "process") {
			const p = this.processes.list().find((p) => p.id === w.id);
			held = held && !!p?.running && !p.triggered;
		}
		if (!held) {
			this.goal.wait = undefined;
			this.save();
		}
		return held;
	}

	scheduleWake(): void {
		if (this.timer) clearTimeout(this.timer);
		if (
			(!this.goal?.wait && !this.wakePending) ||
			this.goal?.status !== "active" ||
			!this.context ||
			!this.eligible(this.context)
		)
			return;
		const ticket = this.epoch;
		this.timer = setTimeout(
			async () => {
				this.timer = undefined;
				if (
					ticket !== this.epoch ||
					!this.context ||
					!this.goal ||
					this.goal.status !== "active"
				)
					return;
				if (this.isWaiting()) {
					this.scheduleWake();
					return;
				}
				this.wakePending = true;
				if (!this.context.isIdle() || this.context.hasPendingMessages()) {
					this.scheduleWake();
					return;
				}
				try {
					await this.submit(this.goal);
				} catch (error) {
					pause(this.goal, `Cannot resume: ${String(error)}`);
					this.save();
				}
			},
			Math.min(
				1000,
				Math.max(
					1,
					(this.goal.wait?.deadline ?? Date.now() + 1000) - Date.now(),
				),
			),
		);
	}
}
