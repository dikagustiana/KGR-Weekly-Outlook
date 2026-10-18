#!/usr/bin/env bash
# The test clock (PRD v5.2-A R70/R71): PostgreSQL and `next start` run under libfaketime with one offset file, so
# now() in SQL and the app's wall clock (lib/clock.ts) are the same fake WIB time and move forward together.
#   clock.sh set 2026-08-28T16:00:00+07:00   move the clock (every process re-reads the file within 1 s)
#   clock.sh now                              the fake time now, WIB
#   clock.sh run <cmd> [args…]                run a command under the fake clock
#   clock.sh env                              the environment assignments (for runuser / env)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

offset() { [[ -f "$E2E_CLOCK_FILE" ]] && tr -d '+\n ' < "$E2E_CLOCK_FILE" || echo 0; }
fake_env() {
  [[ -n "$E2E_FAKETIME_LIB" && -f "$E2E_FAKETIME_LIB" ]] || { echo "libfaketime tidak ditemukan (E2E_FAKETIME_LIB); apt-get install faketime" >&2; exit 1; }
  echo "LD_PRELOAD=$E2E_FAKETIME_LIB FAKETIME_TIMESTAMP_FILE=$E2E_CLOCK_FILE FAKETIME_CACHE_DURATION=1 FAKETIME_DONT_FAKE_MONOTONIC=1"
}

case "${1:-}" in
  set)
    target=$(date -d "$2" +%s) || exit 1
    real=$(LD_PRELOAD= date +%s)
    off=$((target - real))
    mkdir -p "$(dirname "$E2E_CLOCK_FILE")"
    if (( off >= 0 )); then echo "+$off" > "$E2E_CLOCK_FILE.tmp"; else echo "$off" > "$E2E_CLOCK_FILE.tmp"; fi
    chmod 644 "$E2E_CLOCK_FILE.tmp" && mv -f "$E2E_CLOCK_FILE.tmp" "$E2E_CLOCK_FILE"
    sleep 1.3   # FAKETIME_CACHE_DURATION=1: every process sees the new time after this
    echo "jam uji: $(TZ=Asia/Jakarta date -d "@$target" '+%Y-%m-%d %H:%M:%S WIB') (offset ${off}s)"
    ;;
  now)
    TZ=Asia/Jakarta date -d "@$(( $(LD_PRELOAD= date +%s) + $(offset) ))" '+%Y-%m-%dT%H:%M:%S+07:00'
    ;;
  env) fake_env ;;
  run)
    shift
    # shellcheck disable=SC2046
    exec env $(fake_env) "$@"
    ;;
  *) echo "usage: clock.sh set <ISO> | now | env | run <cmd…>" >&2; exit 2 ;;
esac
