#!/usr/bin/env bash
# Stops the e2e stack (app, mock origin, PostgREST, PostgreSQL). Safe to run when nothing is running.
#   down.sh          stop processes, keep $E2E_WORK (database files) for inspection
#   down.sh --clean  also delete $E2E_WORK
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

stop_pid() { # name pidfile
  local pf="$E2E_WORK/pids/$1.pid"
  [[ -f "$pf" ]] || return 0
  local pid; pid="$(cat "$pf")"
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 50); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$pf"
}

for p in app mock postgrest; do stop_pid "$p"; done
# anything still holding our ports (an orphaned `next start` child, for instance)
for port in "$E2E_APP_PORT" "$E2E_SUPA_PORT" "$E2E_PGRST_PORT"; do
  pids="$( (command -v lsof >/dev/null && lsof -t -i "tcp:$port" -sTCP:LISTEN 2>/dev/null) || (command -v fuser >/dev/null && fuser "$port/tcp" 2>/dev/null) || true)"
  # shellcheck disable=SC2086
  [[ -n "${pids// /}" ]] && kill $pids 2>/dev/null || true
done

if [[ -f "$E2E_PG_DATA/postmaster.pid" && -n "$E2E_PG_BIN" ]]; then
  e2e_as_pg env LD_PRELOAD= "$E2E_PG_BIN/pg_ctl" -D "$E2E_PG_DATA" -m fast -w stop >/dev/null 2>&1 || e2e_as_pg env LD_PRELOAD= "$E2E_PG_BIN/pg_ctl" -D "$E2E_PG_DATA" -m immediate stop >/dev/null 2>&1 || true
fi
[[ "${1:-}" == "--clean" ]] && rm -rf "$E2E_WORK"
exit 0
