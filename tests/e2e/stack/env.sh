# shellcheck shell=bash
# Shared settings of the local e2e stack (PRD v5.2-A R70). Sourced by up.sh, down.sh, clock.sh and run.sh.
# Every path, port, URL, key and user comes from the environment; the defaults below are relative to the repository or
# found on PATH, so the same journey can run against another origin (PRD v5.2-B T19: a Supabase staging URL) by
# setting E2E_BASE_URL / E2E_SUPA_URL / E2E_ANON_KEY and friends and skipping up.sh.
# The stack is PostgreSQL 16 + Supabase shim + every migration + PostgREST 12 + a mock Supabase origin (auth, storage)
# + `next start` under faketime. It is NOT Supabase; the logs name it "PG16 lokal + PostgREST 12 + mock auth".
# All secrets here are fixed TEST values for a throwaway local database (the repository is public).

E2E_HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export E2E_ROOT="${E2E_ROOT:-$(cd "$E2E_HERE/../../.." && pwd)}"
export E2E_DIR="$E2E_ROOT/tests/e2e"
export E2E_OUT="${E2E_OUT:-$E2E_DIR/out}"
export E2E_WORK="${E2E_WORK:-$E2E_DIR/.work}"
export E2E_ENV_LABEL="${E2E_ENV_LABEL:-PG16 lokal + PostgREST 12 + mock auth}"

# PostgreSQL 16 server binaries (initdb, pg_ctl, postgres); psql from PATH
_pgbin() {
  local b; b="$(pg_config --bindir 2>/dev/null || true)"
  if [[ -n "$b" && -x "$b/initdb" ]]; then echo "$b"; return; fi
  for b in /usr/lib/postgresql/16/bin /usr/lib/postgresql/*/bin; do [[ -x "$b/initdb" ]] && { echo "$b"; return; }; done
}
export E2E_PG_BIN="${E2E_PG_BIN:-$(_pgbin)}"
export E2E_PG_PORT="${E2E_PG_PORT:-54329}"
export E2E_DB="${E2E_DB:-e2e_kgr}"
export E2E_PG_DATA="${E2E_PG_DATA:-$E2E_WORK/pgdata}"
export E2E_PG_SOCK="${E2E_PG_SOCK:-$E2E_WORK/pgsock}"
export E2E_PG_URL="${E2E_PG_URL:-postgresql://postgres@127.0.0.1:$E2E_PG_PORT/$E2E_DB}"
# initdb / postgres refuse to run as root: then they run as this user (default postgres); non-root runs as itself
export E2E_PG_USER="${E2E_PG_USER:-postgres}"

# PostgREST 12 (static binary on PATH, or E2E_PGRST_BIN)
export E2E_PGRST_BIN="${E2E_PGRST_BIN:-postgrest}"
export E2E_PGRST_PORT="${E2E_PGRST_PORT:-54330}"
export E2E_DB_MAX_ROWS="${E2E_DB_MAX_ROWS:-1000}"

# the mock Supabase origin (REST proxy + auth + storage) and the app
export E2E_SUPA_PORT="${E2E_SUPA_PORT:-54321}"
export E2E_SUPA_URL="${E2E_SUPA_URL:-http://127.0.0.1:$E2E_SUPA_PORT}"
export E2E_APP_PORT="${E2E_APP_PORT:-3100}"
export E2E_BASE_URL="${E2E_BASE_URL:-http://127.0.0.1:$E2E_APP_PORT}"
# build mode of up.sh: always (default) | never (CI: `bash tests/e2e/stack/build.sh` ran as its own step)
export E2E_BUILD="${E2E_BUILD:-always}"

# fixed TEST secrets (never production values)
export E2E_JWT_SECRET="${E2E_JWT_SECRET:-kgr-e2e-local-test-jwt-secret-0000000000000000}"
export E2E_PASSWORD="${E2E_PASSWORD:-e2e-test-password}"
export E2E_CRON_SECRET="${E2E_CRON_SECRET:-e2e-local-test-cron-secret}"
export E2E_EMAIL_DOMAIN="${E2E_EMAIL_DOMAIN:-e2e.test}"
# API keys: keys.mjs signs them from E2E_JWT_SECRET (up.sh writes $E2E_WORK/keys.env); set both to use another project
if [[ -f "$E2E_WORK/keys.env" && -z "${E2E_ANON_KEY:-}" ]]; then
  # shellcheck disable=SC1091
  source "$E2E_WORK/keys.env"
fi

# faketime: one offset file moves the clock of PostgreSQL and `next start` together (clock.sh)
_ftlib() {
  local f; f="$(dpkg -L libfaketime 2>/dev/null | grep '/libfaketime.so.1$' | head -1 || true)"
  [[ -n "$f" ]] && { echo "$f"; return; }
  for f in /usr/lib/*/faketime/libfaketime.so.1 /usr/lib/faketime/libfaketime.so.1 /usr/local/lib/faketime/libfaketime.so.1; do [[ -f "$f" ]] && { echo "$f"; return; }; done
}
export E2E_FAKETIME_LIB="${E2E_FAKETIME_LIB:-$(_ftlib)}"
export E2E_CLOCK_FILE="${E2E_CLOCK_FILE:-$E2E_WORK/faketime.offset}"
export E2E_CLOCK_START="${E2E_CLOCK_START:-2026-08-24T08:00:00+07:00}"

e2e_log() { printf '[%s | jam uji %s] %s\n' "$(date -u +%H:%M:%SZ)" "$("$E2E_HERE/clock.sh" now 2>/dev/null || echo '-')" "$*"; }
# psql against the e2e database as postgres (setup only: never a user flow)
e2e_psql() { psql "$E2E_PG_URL" -v ON_ERROR_STOP=1 -q "$@"; }
# run a command as the PostgreSQL user (root only), keeping the given environment
e2e_as_pg() { if [[ "$(id -u)" == 0 ]]; then runuser -u "$E2E_PG_USER" -- "$@"; else "$@"; fi; }
