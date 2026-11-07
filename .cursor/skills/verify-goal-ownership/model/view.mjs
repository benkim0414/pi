/** Reader-facing labels for /statechart over GoalOwnership.tla */

const statusLabel = {
	none: "No goal",
	paused: "Paused",
	done: "Done",
	cleared: "Cleared",
};

export const title = "Goal ownership and wait";

export const state = (v) => {
	let base = statusLabel[v.status];
	if (!base) {
		if (v.waiting) base = "Active, waiting";
		else if (v.reply) base = "Active, judging";
		else base = "Active";
	}
	return v.continued ? `${base} · continued` : base;
};

export const group = (v) => {
	if (v.status === "cleared" || v.status === "done") return "terminal";
	if (v.status === "paused") return "paused";
	if (v.waiting) return "waiting";
	if (v.reply) return "judging";
	if (v.status === "active") return "active";
	return "idle";
};

export const colors = {
	idle: "tan",
	active: "blue",
	judging: "teal",
	waiting: "yellow",
	paused: "orange",
	terminal: "purple",
};

const stepLabels = {
	SetGoal: "you set a goal",
	Pause: "you pause",
	Clear: "you clear",
	Resume: "you resume",
	HumanInput: "you type",
	StartEvaluate: "a turn settles → judge starts",
	BudgetExhaust: "budget exhausted → pause",
	DropStale: "late judge reply dropped",
	JudgeDone: "judge says done",
	JudgeBlocked: "judge says blocked",
	JudgeContinue: "judge says continue",
	JudgeWaitHeld: "judge says wait [barrier held]",
	JudgeWaitMiss: "judge says wait [barrier missing]",
	BarrierLifts: "wait barrier lifts",
	Idle: null,
};

export const step = (action, _from, _to) => stepLabels[action] ?? action;
