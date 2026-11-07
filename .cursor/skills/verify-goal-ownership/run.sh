#!/usr/bin/env bash
# Run the GoalOwnership TLC check. Requires Java 11+ and tla2tools.jar.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
MODEL="$(cd "$(dirname "$0")/model" && pwd)"
MODE="${1:-all}" # all | ownership
OUT="${2:-}"

if [[ -z "${TLA2TOOLS:-}" ]]; then
	for candidate in \
		"$HOME/.local/share/tla/tla2tools.jar" \
		"$HOME/tla2tools.jar" \
		/usr/local/share/tla/tla2tools.jar; do
		if [[ -f "$candidate" ]]; then
			export TLA2TOOLS="$candidate"
			break
		fi
	done
fi
if [[ -z "${TLA2TOOLS:-}" || ! -f "$TLA2TOOLS" ]]; then
	echo "Set TLA2TOOLS to tla2tools.jar (Java 11+). Download:" >&2
	echo "  curl -fsSL -o ~/.local/share/tla/tla2tools.jar \\" >&2
	echo "    https://github.com/tlaplus/tlaplus/releases/download/v1.8.0/tla2tools.jar" >&2
	exit 2
fi
export JAVA="${JAVA:-$(command -v java)}"

CFG="GoalOwnership.cfg"
if [[ "$MODE" == "ownership" ]]; then
	CFG="GoalOwnershipOwnershipOnly.cfg"
fi

if [[ -z "$OUT" ]]; then
	OUT="$(mktemp -d /tmp/goal-ownership.XXXXXX)"
fi
mkdir -p "$OUT"

# Prefer pstack /statechart when available; fall back to bare TLC.
STATECHART=""
if [[ -n "${STATECHART_SCRIPT:-}" && -f "$STATECHART_SCRIPT" ]]; then
	STATECHART="$STATECHART_SCRIPT"
else
	STATECHART="$(find "$HOME/.cursor/plugins" -path '*/skills/statechart/scripts/statechart.ts' 2>/dev/null | head -1 || true)"
fi

SCRATCH="$(mktemp -d /tmp/goal-ownership-model.XXXXXX)"
cp "$MODEL"/* "$SCRATCH/"
cd "$SCRATCH"

if [[ -n "$STATECHART" ]]; then
	set +e
	node "$STATECHART" GoalOwnership.tla --config "$CFG" --view view.mjs --out "$OUT"
	code=$?
	set -e
else
	set +e
	"$JAVA" -XX:+UseParallelGC -cp "$TLA2TOOLS" tlc2.TLC -config "$CFG" GoalOwnership.tla | tee "$OUT/tlc.out"
	code=${PIPESTATUS[0]}
	set -e
	echo "Bare TLC exit $code. Install pstack and use /statechart to get a path report." >"$OUT/report.md"
fi

rm -rf "$SCRATCH"
echo "OUT=$OUT"
exit "$code"
