#!/usr/bin/env bash
# The lint scripts must fail on a violating file and pass on a clean one (PRD v5.2 Fase 0: a lint that never exits 1
# proves nothing). Fixtures: scripts/lint-fixtures/<rule>/{bad,good}.
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0
expect() { # rule dir want-exit want-hits
  local out code hits
  out=$(python3 -I scripts/lint.py "$1" "scripts/lint-fixtures/$1/$2"); code=$?
  hits=$(printf '%s\n' "$out" | grep -c "^${1^^} scripts/")
  if [[ "$code" -ne "$3" || "$hits" -ne "$4" ]]; then
    echo "FAIL lint $1 $2: exit $code (harap $3), $hits hit (harap $4)"; printf '%s\n' "$out"; fail=1
  else
    echo "ok   lint $1 $2: exit $code, $hits hit"
  fi
}
expect k41 bad 1 7
expect k41 good 0 0
expect k42 bad 1 6
expect k42 good 0 0
# R64: 11 numbered lines (a marker without a reason or without the colon counts as a hit; two zeros on one line count once)
expect missing bad 1 11
expect missing good 0 0
exit "$fail"
