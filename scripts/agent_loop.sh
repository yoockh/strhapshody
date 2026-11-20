#!/usr/bin/env bash
# Long-running build loop: repeatedly invokes Claude Code in print mode to
# work through TASKS.md one checkbox (= one commit) at a time, self-testing
# and committing/pushing before moving to the next item.
#
# Safety: --dangerously-skip-permissions is scoped to this one project
# directory (own git remote, no secrets, no sudo available anyway) and is
# required because nobody is watching the TUI to approve prompts.
set -uo pipefail

cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"
LOG="$PROJECT_DIR/scripts/agent_loop.log"
MAX_ITERS="${1:-40}"

echo "=== agent_loop started $(date -Iseconds) (max $MAX_ITERS iterations) ===" >> "$LOG"

PROMPT='Read CLAUDE.md, TASKS.md, DECISIONS.md, DEVLOG.md and TESTING.md in this repo root first.
Pick the SINGLE next unchecked "[ ]" task in TASKS.md (top to bottom, respecting phase order/dependencies).
Implement ONLY that one task. Keep the diff scoped to it.
Then self-test it per TESTING.md (cargo test for Rust code, npm test / vitest for TS code) - all relevant
tests must pass before you commit. If you add new testable logic, add a test for it.
Update TASKS.md to check that box off. Append one dated entry to DEVLOG.md (did/tested/next/needs human
verification fields, per its established format). If DECISIONS.md needs a new ADR for a choice you made,
add it (append-only, never edit past entries).
If everything is green: git add the relevant files and git commit with a clean, conventional-commit-style
message scoped to just this one feature/task, then git push origin HEAD:main.
If you get blocked (missing tool, failing test you cannot fix, ambiguous spec) DO NOT commit broken or
untested code - instead write a clear blocker entry in DEVLOG.md explaining exactly what is blocked and
what you need, leave the TASKS.md box unchecked, and stop.
If ALL boxes in TASKS.md are already checked, write a DEVLOG.md entry saying the task list is complete and
stop without making changes.
Work autonomously end to end for this one task - nobody is watching, so do not ask questions; make the best
reasonable call per the PRD and DECISIONS.md and keep going.'

for i in $(seq 1 "$MAX_ITERS"); do
  echo "--- iteration $i/$MAX_ITERS $(date -Iseconds) ---" >> "$LOG"
  source "$HOME/.cargo/env" 2>/dev/null || true
  OUT=$(claude -p "$PROMPT" \
    --dangerously-skip-permissions \
    --max-turns 80 \
    --output-format json \
    2>>"$LOG")
  echo "$OUT" >> "$LOG"

  SUBTYPE=$(echo "$OUT" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)
    print(d.get("subtype","unknown"))
except Exception as e:
    print("parse_error")' 2>/dev/null)
  echo "iteration $i subtype=$SUBTYPE" >> "$LOG"

  REMAINING=$(grep -c '^\s*- \[ \]' TASKS.md || true)
  echo "iteration $i remaining_unchecked_tasks=$REMAINING" >> "$LOG"
  if [ "$REMAINING" = "0" ]; then
    echo "=== all TASKS.md items checked, stopping at iteration $i ===" >> "$LOG"
    break
  fi
  if [ "$SUBTYPE" = "parse_error" ]; then
    echo "=== claude invocation parse error, stopping to avoid burning budget blind ===" >> "$LOG"
    break
  fi
done

echo "=== agent_loop finished $(date -Iseconds) ===" >> "$LOG"
