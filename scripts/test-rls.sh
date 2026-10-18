#!/usr/bin/env bash
# pnpm test:rls — role tests (supabase/tests/rls_roles.sql) against a disposable database.
#   DATABASE_URL set  → plain PostgreSQL (CI service container / local): applies the Supabase shim,
#                        every migration, the seed, then the tests. Never point this at a Supabase project.
#   SUPABASE_DB_URL   → a Supabase branch / preview DB that already has the migrations: runs the tests only.
#   neither           → skipped with a warning (exit 0).
# The tests always roll back; an outcome marked (!) fails the run.
set -uo pipefail
cd "$(dirname "$0")/.."
if [[ -n "${DATABASE_URL:-}" ]]; then
  URL="$DATABASE_URL"
  psql "$URL" -v ON_ERROR_STOP=1 -q -f supabase/tests/supabase_shim.sql || exit 1
  for f in supabase/migrations/*.sql; do psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || { echo "migration failed: $f"; exit 1; }; done
  for f in supabase/seed/*.sql; do psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || { echo "seed failed: $f"; exit 1; }; done
  # re-run on the seeded database (as production: v1 + seed first, then v3/v4): every migration must be idempotent
  for f in supabase/migrations/2026101[6-9]*.sql supabase/migrations/202610[2-9]*.sql; do
    [[ -f "$f" ]] || continue
    psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>&1 || { echo "migration not re-runnable: $f"; exit 1; }
  done
  for f in supabase/tests/v3_*.sql; do [[ -f "$f" ]] && { psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" || exit 1; }; done
  # every table, column and rpc the web app asks PostgREST for exists in the schema just migrated (mocks cannot see it)
  T=$(mktemp -d)
  psql "$URL" -Atc "select table_name || '|' || column_name from information_schema.columns where table_schema = 'public'" > "$T/cols" || exit 1
  psql "$URL" -Atc "select proname from pg_proc where pronamespace = 'public'::regnamespace" > "$T/fns" || exit 1
  python3 -I scripts/check-query-columns.py "$T/cols" "$T/fns" || { echo "test:rls FAILED (query columns)"; exit 1; }
elif [[ -n "${SUPABASE_DB_URL:-}" ]]; then
  URL="$SUPABASE_DB_URL"
else
  echo "test:rls SKIPPED — set DATABASE_URL (disposable PostgreSQL) or SUPABASE_DB_URL (Supabase branch)."
  exit 0
fi
OUT=$(psql "$URL" -q -f supabase/tests/rls_roles.sql 2>&1)
# here-strings, not `echo "$OUT" | grep -q`: grep -q exits at the first match, echo then dies of SIGPIPE and, under
# pipefail, the whole check reads as "no match" (seen in CI once the output outgrew the pipe buffer)
grep -o 'RLS-RESULTS[^$]*' <<< "$OUT" | sed 's/; /;\n  /g'
if ! grep -q 'RLS-RESULTS' <<< "$OUT"; then echo "$OUT"; echo "test:rls FAILED (no results)"; exit 1; fi
WANT=$(grep -c "raise exception 'RLS-RESULTS" supabase/tests/rls_roles.sql)
GOT=$(grep -c 'RLS-RESULTS' <<< "$OUT")
if [[ "$GOT" -ne "$WANT" ]]; then grep -v 'RLS-RESULTS' <<< "$OUT" | tail -8; echo "test:rls FAILED ($GOT of $WANT blocks reported)"; exit 1; fi
if grep -q '(!)' <<< "$OUT"; then echo "test:rls FAILED (unexpected outcome marked (!))"; exit 1; fi
echo "test:rls OK"
