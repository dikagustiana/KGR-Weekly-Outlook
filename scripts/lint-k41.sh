#!/usr/bin/env bash
# K41/K56 (PRD v5.2-A R43): a read must never swallow a PostgREST error and read as "no rows / not strict".
# Exits 1 when any offending line is found. Whitelist (Bab 5.3): lib/clock.ts (documented wall-date fallback) and
# lib/loader.ts (the must/mustRows/orMissingTable helpers themselves).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
report() { echo "$1"; fail=1; }

files() {
  find apps/web -type f \( -name '*.ts' -o -name '*.tsx' \) \
    | grep -v '\.test\.' | grep -v '\.spec\.' \
    | grep -v 'apps/web/lib/clock\.ts' \
    | grep -v 'apps/web/lib/loader\.ts'
}

while IFS= read -r f; do
  # 1) `const { data } = await` / `const { data: x } = await` without `error` in the same destructuring
  while IFS=: read -r ln rest; do
    if ! printf '%s' "$rest" | grep -qE '\{ data(: [A-Za-z0-9_]+)?, error \}'; then
      report "K41 $f:$ln: baca tanpa cek error — $rest"
    fi
  done < <(grep -nE 'const \{ data(: [A-Za-z0-9_]+)? \} = await' "$f" 2>/dev/null)

  # 2) catch () {   3) .catch(() =>   4) data ?? [])
  grep -nE 'catch \(\) \{|\.catch\(\(\) =>|data \?\? \[\]\)' "$f" 2>/dev/null \
    | while IFS= read -r hit; do report "K41 $f: $hit"; done
done < <(files)

exit "$fail"
