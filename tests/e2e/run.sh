#!/usr/bin/env bash
# pnpm e2e (PRD v5.2-A R70-R74, K64): the whole harness in one command.
#   stack up (PG16 + shim + migrations twice + seed + users + PostgREST 12 + mock Supabase + next start under faketime)
#   → prepare (flags, the one Admin rebuild) → snapshot → matrix → O → T7 → (afterT7) A6 → L → P → R69 → F19 → volume → summary
# Logs, screenshots and the stack's own logs go to tests/e2e/out (gitignored; the CI job uploads it). Exit code 1 on any failed check,
# unexpected 4xx/5xx or journey that did not finish; expected-to-fail steps (XFAIL) are listed, they do not fail the run.
#   E2E_BUILD=never      reuse apps/web/.next (CI builds in its own step: pnpm e2e:build)
#   E2E_SKIP_UP=1        do not start, snapshot or stop the stack (journeys against a stack you started; see stack/env.sh for the variables)
#   E2E_KEEP=1           leave the stack running afterwards
#   E2E_ONLY="T7 F19"    run only these journeys (matrix O T7 A6 L P R69 F19 volume); A6, L, P, R69, F19 and volume run on the database T7 leaves, so T7 runs first;
#                        O (WP upload moves the data date, the clock of the app) starts from the prepared database, like matrix and T7
#   E2E_SCREENS=1        A6 also takes the screenshots of the six main screens at 1366x768, 899 and 390 px (out/screens/A6-*.png); opt-in
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/stack/env.sh"
STACK="$E2E_HERE"   # env.sh sets E2E_HERE to its own directory (tests/e2e/stack)
cd "$E2E_ROOT"
rm -rf "$E2E_OUT"; mkdir -p "$E2E_OUT/screens" "$E2E_OUT/stack"
exec > >(tee "$E2E_OUT/run.log") 2>&1

echo "== e2e: $E2E_ENV_LABEL · $(date -u +%FT%TZ) (jam dinding) · node $(node -v) · commit $(git rev-parse --short HEAD 2>/dev/null || echo '-')"
FAIL=0
only() { [[ -z "${E2E_ONLY:-}" || " $E2E_ONLY " == *" $1 "* ]]; }
step() { # name command…
  local name="$1"; shift
  echo; echo "---- $name · $(date -u +%H:%M:%SZ) ----"
  "$@"; local rc=$?
  echo "$rc" > "$E2E_OUT/exit-$name.txt"
  if (( rc != 0 )); then echo "!!!! $name keluar dengan kode $rc"; FAIL=1; fi
  return 0
}
snap() { [[ -n "${E2E_SKIP_UP:-}" ]] || bash "$STACK/snapshot.sh" "$@"; }
finish() {
  mkdir -p "$E2E_OUT/stack"
  for f in postgres postgrest mock app initdb; do [[ -f "$E2E_WORK/log/$f.log" ]] && cp "$E2E_WORK/log/$f.log" "$E2E_OUT/stack/$f.log"; done
  for f in migrate.err restore.err; do [[ -f "$E2E_WORK/log/$f" ]] && cp "$E2E_WORK/log/$f" "$E2E_OUT/stack/$f"; done
  if [[ -z "${E2E_KEEP:-}" && -z "${E2E_SKIP_UP:-}" ]]; then bash "$STACK/down.sh"; fi
}
trap finish EXIT

if [[ -z "${E2E_SKIP_UP:-}" ]]; then
  bash "$STACK/up.sh" || { echo "!!!! stack tidak naik; berhenti"; exit 1; }
fi
# keys.env is written by up.sh; the journeys read the same variables
# shellcheck disable=SC1091
[[ -f "$E2E_WORK/keys.env" ]] && source "$E2E_WORK/keys.env"
export E2E_ANON_KEY E2E_SERVICE_KEY

step prepare node "$E2E_DIR/prepare.cjs"
snap save prepared
if only matrix; then snap restore prepared; step matrix node "$E2E_DIR/matrix.cjs"; fi
# O (PRD v5.2-A R70, v5.1 O2 and O5): the WP of the batch of 26 Aug moves the data date, the clock of the app; starts from the prepared database
if only O; then snap restore prepared; step O node "$E2E_DIR/journey-O.cjs"; fi
NEEDS_T7=0; for j in T7 A6 L P R69 F19 volume; do only "$j" && NEEDS_T7=1; done
if (( NEEDS_T7 )); then snap restore prepared; step T7 node "$E2E_DIR/journey-T7.cjs"; fi
# the journeys that start where T7 stops (Friday 28 Aug 2026 ~16.50, the week 24-30 Aug filled and released) each put the database back: the SETUP of
# A6 writes uploads of October and a long queue, L changes the commitment, P rewrites the grid and releases again, R69 moves the clock to 1 Sep, imports
# an FS, overrides and locks FINAL of August
if only A6 || only L || only P || only R69; then snap save afterT7; fi
if only A6; then step A6 node "$E2E_DIR/journey-A6.cjs"; snap restore afterT7; fi
if only L; then step L node "$E2E_DIR/journey-L.cjs"; snap restore afterT7; fi
if only P; then step P node "$E2E_DIR/journey-P.cjs"; snap restore afterT7; fi
if only R69; then step R69 node "$E2E_DIR/journey-R69.cjs"; snap restore afterT7; fi
if only F19; then step F19 node "$E2E_DIR/journey-F19.cjs"; fi
if only volume; then step volume node "$E2E_DIR/journey-volume.cjs"; fi

node "$E2E_DIR/summarize.cjs" || FAIL=1
exit "$FAIL"
