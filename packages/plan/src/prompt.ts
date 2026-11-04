export function buildPlanPrompt(task: string): string {
	const request = task.trim();
	return `For this turn only, plan the task without executing it.
Preserve explicit user constraints, repository guidance, and approval boundaries.
Use read-only inspection to ground the plan. Do not implement code, edit unrelated
files, run mutating terminal commands, commit, push, or perform external actions.
The only permitted artifact write is the plan Markdown file and its directory.
${request ? `Task to plan:\n${request}` : "Infer the task from the current conversation. If no clear task exists, ask a brief clarifying question."}
Resolve high-impact ambiguities before finalizing. Save an actionable Markdown
plan under .pi/plans/YYYY-MM-DD_HHMMSS-<slug>.md relative to the active working
directory. Create the directory if allowed. Never overwrite an existing plan;
append a numeric suffix on collision. Follow repository-required destinations
and worktree isolation instead where applicable, and report the actual path.
Include the goal, relevant context and assumptions, proposed approach, ordered
implementation tasks, acceptance criteria, verification commands with expected
results, and material risks. Identify concrete files after inspection. Include
code examples when needed to remove ambiguity. Make the plan usable by an
implementer without conversation context. Ask before finalizing unresolved
high-impact decisions. After saving, briefly describe the plan and its saved
path. If saving fails, explain the failure honestly. Do not start executing the
plan in this turn. These planning restrictions apply only to this turn.`;
}
