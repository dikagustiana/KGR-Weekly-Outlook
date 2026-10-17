#!/usr/bin/env bash
# The local e2e stack (PRD v5.2-A R70):
#   fresh PostgreSQL 16 (own cluster, own port, under faketime)
#     → Supabase shim → every migration twice → seed → tests/e2e/sql/users.sql
#     → PostgREST 12 (anon role, JWT secret from env, db-max-rows)
#     → mock-supa.mjs: one origin acting as the Supabase URL (/rest/v1 → PostgREST, /auth/v1 minimal GoTrue, /storage/v1)
#     → `next build` + `next start` under faketime with NEXT_PUBLIC_SUPABASE_URL = the mock origin.
# Needs: PostgreSQL 16 server binaries, psql, libfaketime, the PostgREST 12 binary, node ≥ 20, pnpm install done.
# Nothing here touches a Supabase project: the database is a throwaway cluster in $E2E_WORK.
#   up.sh                  everything
#   E2E_BUILD=never up.sh  reuse the existing `next build` (CI builds in its own step: stack/build.sh)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
CLOCK="$E2E_HERE/clock.sh"
mkdir -p "$E2E_OUT/stack" "$E2E_WORK/log" "$E2E_WORK/pids"

need() { command -v "$1" >/dev/null 2>&1 || [[ -x "$1" ]] || { echo "up.sh: '$1' tidak ditemukan. $2" >&2; exit 1; }; }
need psql "apt-get install postgresql-client-16"
need "$E2E_PGRST_BIN" "Unduh PostgREST 12: https://github.com/PostgREST/postgrest/releases/download/v12.2.3/postgrest-v12.2.3-linux-static-x64.tar.xz (taruh di PATH atau set E2E_PGRST_BIN)"
need node "Node ≥ 20"
[[ -n "$E2E_PG_BIN" && -x "$E2E_PG_BIN/initdb" ]] || { echo "up.sh: initdb PostgreSQL tidak ditemukan (set E2E_PG_BIN; apt-get install postgresql-16)" >&2; exit 1; }
[[ -n "$E2E_FAKETIME_LIB" && -f "$E2E_FAKETIME_LIB" ]] || { echo "up.sh: libfaketime tidak ditemukan (apt-get install faketime; atau set E2E_FAKETIME_LIB)" >&2; exit 1; }
[[ "$("$E2E_PGRST_BIN" --version 2>&1)" == *"PostgREST 12."* ]] || echo "up.sh: peringatan: PostgREST bukan versi 12 ($("$E2E_PGRST_BIN" --version 2>&1))" >&2

"$E2E_HERE/down.sh" --clean
mkdir -p "$E2E_OUT/stack" "$E2E_WORK/log" "$E2E_WORK/pids" "$E2E_PG_DATA" "$E2E_PG_SOCK"
if [[ "$(id -u)" == 0 ]]; then chown -R "$E2E_PG_USER" "$E2E_PG_DATA" "$E2E_PG_SOCK" "$E2E_WORK/log"; fi
chmod 700 "$E2E_PG_DATA"

echo "== Lingkungan: $E2E_ENV_LABEL"
echo "== PostgreSQL $("$E2E_PG_BIN/postgres" --version | awk '{print $3}') · PostgREST $("$E2E_PGRST_BIN" --version | awk '{print $2}') · node $(node -v) · faketime $E2E_FAKETIME_LIB"

# ---------------------------------------------------------------------------------------------------------- the clock
"$CLOCK" set "$E2E_CLOCK_START" | sed 's/^/[up] /'

# --------------------------------------------------------------------------------------------------------- PostgreSQL
e2e_log "[up] initdb (jam uji faketime)"
# shellcheck disable=SC2046
e2e_as_pg env $("$CLOCK" env) "$E2E_PG_BIN/initdb" -D "$E2E_PG_DATA" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >"$E2E_WORK/log/initdb.log" 2>&1 || { cat "$E2E_WORK/log/initdb.log"; exit 1; }
cat >>"$E2E_PG_DATA/postgresql.conf" <<CONF
port = $E2E_PG_PORT
listen_addresses = '127.0.0.1'
unix_socket_directories = '$E2E_PG_SOCK'
fsync = off
synchronous_commit = off
full_page_writes = off
shared_buffers = 256MB
max_connections = 100
timezone = 'UTC'
log_timezone = 'UTC'
log_line_prefix = '%m [%p] %q%u@%d '
log_min_messages = warning
CONF
e2e_log "[up] start PostgreSQL di port $E2E_PG_PORT (faketime: now() di SQL = jam uji)"
# shellcheck disable=SC2046
e2e_as_pg env $("$CLOCK" env) "$E2E_PG_BIN/pg_ctl" -D "$E2E_PG_DATA" -l "$E2E_WORK/log/postgres.log" -w -t 60 start >/dev/null
psql "postgresql://postgres@127.0.0.1:$E2E_PG_PORT/postgres" -q -c "create database $E2E_DB" >/dev/null
e2e_log "[up] PostgreSQL: now() = $(psql "$E2E_PG_URL" -Atc "select to_char(now() at time zone 'Asia/Jakarta', 'YYYY-MM-DD HH24:MI:SS \"WIB\"')")"

# ------------------------------------------------------------------------------------------ shim, migrations, seed, users
psqlq() { psql "$E2E_PG_URL" -v ON_ERROR_STOP=1 -q "$@"; }
e2e_log "[up] shim: supabase/tests/supabase_shim.sql"
psqlq -f "$E2E_ROOT/supabase/tests/supabase_shim.sql" >/dev/null
migrate_pass() { # label glob…
  local label="$1"; shift
  local n=0 f
  for f in "$@"; do
    [[ -f "$f" ]] || continue
    psqlq -f "$f" >/dev/null 2>"$E2E_WORK/log/migrate.err" || { echo "migrasi gagal ($label): $f" >&2; cat "$E2E_WORK/log/migrate.err" >&2; exit 1; }
    n=$((n + 1))
  done
  e2e_log "[up] migrasi $label: $n berkas"
}
ALL=("$E2E_ROOT"/supabase/migrations/*.sql)
migrate_pass "pass 1 (database kosong)" "${ALL[@]}"
# the second pass proves the migrations are idempotent; only the two v1 bootstrap files (schema, security: plain
# CREATE TABLE / CREATE TRIGGER) are not re-runnable by design, scripts/test-rls.sh skips them too
RERUN=()
for f in "${ALL[@]}"; do
  case "$f" in */20261014000100_schema.sql|*/20261014000200_security.sql) ;; *) RERUN+=("$f") ;; esac
done
migrate_pass "pass 2 (ulang, idempoten)" "${RERUN[@]}"
n=0; for f in "$E2E_ROOT"/supabase/seed/*.sql; do psqlq -f "$f" >/dev/null; n=$((n + 1)); done
e2e_log "[up] seed: $n berkas (supabase/seed, fixture minggu 24–30 Agu 2026)"
migrate_pass "pass 3 (sesudah seed: backfill terhadap data seed, urutan production)" "${RERUN[@]}"
e2e_log "[up] users: tests/e2e/sql/users.sql (9 role + admin untuk bangun ulang awal; setup, bukan alur)"
psqlq -v "pw=$E2E_PASSWORD" -v "domain=$E2E_EMAIL_DOMAIN" -f "$E2E_DIR/sql/users.sql" >/dev/null
e2e_log "[up] DB siap: $(psql "$E2E_PG_URL" -Atc "select count(*) from public.sales_line") baris sales_line, $(psql "$E2E_PG_URL" -Atc "select count(*) from public.app_user") user"

# ----------------------------------------------------------------------------------------------------------- API keys
node "$E2E_HERE/keys.mjs" env >"$E2E_WORK/keys.env"
# shellcheck disable=SC1091
source "$E2E_WORK/keys.env"
export E2E_ANON_KEY E2E_SERVICE_KEY

# ---------------------------------------------------------------------------------------------------------- PostgREST
cat >"$E2E_WORK/postgrest.conf" <<CONF
db-uri = "postgres://authenticator@127.0.0.1:$E2E_PG_PORT/$E2E_DB"
db-schemas = "public"
db-extra-search-path = "public, extensions"
db-anon-role = "anon"
db-max-rows = $E2E_DB_MAX_ROWS
db-pool = 10
jwt-secret = "$E2E_JWT_SECRET"
server-host = "127.0.0.1"
server-port = $E2E_PGRST_PORT
log-level = "warn"
CONF
e2e_log "[up] PostgREST di port $E2E_PGRST_PORT (db-max-rows=$E2E_DB_MAX_ROWS; jam dinding: PostgREST bukan proses faketime, binari statis)"
setsid nohup "$E2E_PGRST_BIN" "$E2E_WORK/postgrest.conf" >"$E2E_WORK/log/postgrest.log" 2>&1 </dev/null &
echo $! >"$E2E_WORK/pids/postgrest.pid"

wait_http() { # name url [seconds]
  local i; for i in $(seq 1 "${3:-60}"); do
    if curl -s -o /dev/null --max-time 2 "$2"; then return 0; fi
    sleep 1
  done
  echo "up.sh: $1 tidak naik ($2)" >&2; return 1
}
wait_http PostgREST "http://127.0.0.1:$E2E_PGRST_PORT/" 30 || { tail -20 "$E2E_WORK/log/postgrest.log" >&2; exit 1; }

# ---------------------------------------------------------------------------------------------------- mock Supabase origin
e2e_log "[up] mock Supabase di $E2E_SUPA_URL (/rest/v1 → PostgREST, /auth/v1, /storage/v1)"
E2E_PGRST_URL="http://127.0.0.1:$E2E_PGRST_PORT" setsid nohup node "$E2E_HERE/mock-supa.mjs" >"$E2E_WORK/log/mock.log" 2>&1 </dev/null &
echo $! >"$E2E_WORK/pids/mock.pid"
wait_http "mock Supabase" "$E2E_SUPA_URL/__e2e/health" 30 || { tail -20 "$E2E_WORK/log/mock.log" >&2; exit 1; }

# -------------------------------------------------------------------------------------------------------------- app
if [[ "$E2E_BUILD" != "never" ]]; then "$E2E_HERE/build.sh"; fi
[[ -f "$E2E_ROOT/apps/web/.next/BUILD_ID" ]] || { echo "up.sh: apps/web/.next belum ada; jalankan stack/build.sh atau E2E_BUILD=always" >&2; exit 1; }
if [[ -f "$E2E_ROOT/apps/web/.next/e2e-supa-url" && "$(cat "$E2E_ROOT/apps/web/.next/e2e-supa-url")" != "$E2E_SUPA_URL|$E2E_ANON_KEY" ]]; then
  echo "up.sh: build lama dibuat untuk URL/kunci Supabase lain; jalankan stack/build.sh lagi" >&2; exit 1
fi
e2e_log "[up] next start di port $E2E_APP_PORT (faketime; NEXT_PUBLIC_SUPABASE_URL = mock)"
(
  cd "$E2E_ROOT/apps/web"
  # shellcheck disable=SC2046
  NODE_ENV=production NEXT_PUBLIC_SUPABASE_URL="$E2E_SUPA_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$E2E_ANON_KEY" \
  SUPABASE_SERVICE_ROLE_KEY="$E2E_SERVICE_KEY" CRON_SECRET="$E2E_CRON_SECRET" NEXT_TELEMETRY_DISABLED=1 \
  setsid nohup env $("$CLOCK" env) "$E2E_ROOT/apps/web/node_modules/.bin/next" start -p "$E2E_APP_PORT" -H 127.0.0.1 >"$E2E_WORK/log/app.log" 2>&1 </dev/null &
  echo $! >"$E2E_WORK/pids/app.pid"
)
wait_http "next start" "$E2E_BASE_URL/login" 90 || { tail -30 "$E2E_WORK/log/app.log" >&2; exit 1; }
e2e_log "[up] stack naik: app $E2E_BASE_URL · Supabase (mock) $E2E_SUPA_URL · PostgREST :$E2E_PGRST_PORT · PostgreSQL :$E2E_PG_PORT/$E2E_DB"
