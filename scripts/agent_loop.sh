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

i=1
RATE_LIMIT_RETRIES=0
MAX_RATE_LIMIT_RETRIES=20
while [ "$i" -le "$MAX_ITERS" ]; do
  echo "--- iteration $i/$MAX_ITERS $(date -Iseconds) ---" >> "$LOG"
  source "$HOME/.cargo/env" 2>/dev/null || true
  OUT=$(claude -p "$PROMPT" \
    --dangerously-skip-permissions \
    --max-turns 80 \
    --output-format json \
    2>>"$LOG")
  echo "$OUT" >> "$LOG"

  EVAL_JSON=$(echo "$OUT" | python3 -c 'import json,sys
try:
    d=json.load(sys.stdin)
    print(json.dumps({
        "subtype": d.get("subtype","unknown"),
        "is_error": bool(d.get("is_error", False)),
        "api_error": d.get("api_error",""),
        "result": d.get("result","")[:200],
    }))
except Exception:
    print(json.dumps({"subtype":"parse_error","is_error":True,"api_error":"","result":""}))' 2>/dev/null)
  SUBTYPE=$(echo "$EVAL_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["subtype"])')
  IS_ERROR=$(echo "$EVAL_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["is_error"])')
  API_ERROR=$(echo "$EVAL_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["api_error"])')
  RESULT_TXT=$(echo "$EVAL_JSON" | python3 -c 'import json,sys;print(json.load(sys.stdin)["result"])')
  echo "iteration $i subtype=$SUBTYPE is_error=$IS_ERROR api_error=$API_ERROR" >> "$LOG"

  if [ "$SUBTYPE" = "parse_error" ]; then
    echo "=== claude invocation parse error, stopping to avoid burning budget blind ===" >> "$LOG"
    break
  fi

  if [ "$IS_ERROR" = "True" ] && [ "$API_ERROR" = "usage_limit_reached" ]; then
    RATE_LIMIT_RETRIES=$((RATE_LIMIT_RETRIES + 1))
    if [ "$RATE_LIMIT_RETRIES" -gt "$MAX_RATE_LIMIT_RETRIES" ]; then
      echo "=== too many rate-limit retries ($RATE_LIMIT_RETRIES), stopping ===" >> "$LOG"
      break
    fi
    # Parse "resets H:MMam/pm (Zone)" out of the result text and sleep until then.
    RESET_EPOCH=$(python3 -c "
import re, sys
from datetime import datetime, timedelta
text = '''$RESULT_TXT'''
m = re.search(r'resets\s+(\d{1,2}):(\d{2})\s*(am|pm)', text, re.I)
if not m:
    print(0)
else:
    h, mi, ap = int(m.group(1)), int(m.group(2)), m.group(3).lower()
    if ap == 'pm' and h != 12:
        h += 12
    if ap == 'am' and h == 12:
        h = 0
    now = datetime.now()
    target = now.replace(hour=h, minute=mi, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    print(int(target.timestamp()))
" 2>/dev/null)
    NOW_EPOCH=$(date +%s)
    if [ -n "$RESET_EPOCH" ] && [ "$RESET_EPOCH" != "0" ] && [ "$RESET_EPOCH" -gt "$NOW_EPOCH" ]; then
      SLEEP_SECS=$(( RESET_EPOCH - NOW_EPOCH + 60 ))
    else
      SLEEP_SECS=1800
    fi
    echo "=== usage limit hit (retry $RATE_LIMIT_RETRIES/$MAX_RATE_LIMIT_RETRIES), sleeping ${SLEEP_SECS}s until reset: $RESULT_TXT ===" >> "$LOG"
    sleep "$SLEEP_SECS"
    continue
  fi

  if [ "$IS_ERROR" = "True" ]; then
    echo "=== claude returned a non-rate-limit error ($API_ERROR), stopping: $RESULT_TXT ===" >> "$LOG"
    break
  fi

  REMAINING=$(grep -c '^\s*- \[ \]' TASKS.md || true)
  echo "iteration $i remaining_unchecked_tasks=$REMAINING" >> "$LOG"
  if [ "$REMAINING" = "0" ]; then
    echo "=== all TASKS.md items checked, stopping at iteration $i ===" >> "$LOG"
    break
  fi

  i=$((i + 1))
done

echo "=== agent_loop finished $(date -Iseconds) ===" >> "$LOG"
