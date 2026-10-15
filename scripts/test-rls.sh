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
  # re-run: every migration must be idempotent
  for f in supabase/migrations/2026101[6-9]*.sql supabase/migrations/202610[2-9]*.sql; do
    [[ -f "$f" ]] || continue
    psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null 2>&1 || { echo "migration not re-runnable: $f"; exit 1; }
  done
  for f in supabase/seed/*.sql; do psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null || { echo "seed failed: $f"; exit 1; }; done
  for f in supabase/tests/v3_*.sql; do [[ -f "$f" ]] && { psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f" || exit 1; }; done
elif [[ -n "${SUPABASE_DB_URL:-}" ]]; then
  URL="$SUPABASE_DB_URL"
else
  echo "test:rls SKIPPED — set DATABASE_URL (disposable PostgreSQL) or SUPABASE_DB_URL (Supabase branch)."
  exit 0
fi
OUT=$(psql "$URL" -q -f supabase/tests/rls_roles.sql 2>&1)
echo "$OUT" | grep -o 'RLS-RESULTS[^$]*' | sed 's/; /;\n  /g'
if ! echo "$OUT" | grep -q 'RLS-RESULTS'; then echo "$OUT"; echo "test:rls FAILED (no results)"; exit 1; fi
if echo "$OUT" | grep -q '(!)'; then echo "test:rls FAILED (unexpected outcome marked (!))"; exit 1; fi
echo "test:rls OK"
