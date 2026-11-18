#!/usr/bin/env bash
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT" || exit 2

FAIL=0
CHECKS=""
run() {
  local name="$1"; shift
  local log="/tmp/kilo-pilot-${name}.log"
  if "$@" >"$log" 2>&1; then
    echo "  ok $name"
    CHECKS="${CHECKS}${name}:pass "
  else
    echo "  FAIL $name"
    tail -6 "$log"
    CHECKS="${CHECKS}${name}:fail "
    FAIL=1
  fi
}

echo "=== kilo-pilot gate ==="
run tests node --test
run spec_trace_selftest node tools/verification/spec-trace.mjs --self-test
run spec_trace node tools/verification/spec-trace.mjs
run mandate_selftest node tools/agent/mandate-guard.mjs --self-test
run mandate node tools/agent/mandate-guard.mjs
run agent_task node agent/run-task.mjs
run eval_selftest node tools/agent/eval.mjs --self-test
run eval node tools/agent/eval.mjs

STATUS=PASS
[ "$FAIL" = "1" ] && STATUS=FAIL
node tools/verification/pilot-manifest.mjs --project "$ROOT" --status "$STATUS" --checks "$CHECKS"
echo "pilot-gate: $STATUS"
[ "$FAIL" = "0" ]
