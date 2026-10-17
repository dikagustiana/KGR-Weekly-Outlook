#!/usr/bin/env bash
# K42 (PRD v5.2-A R47): stable pagination and chunked `.in()`. Exits 1 on violation.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
report() { echo "$1"; fail=1; }

files() { find apps/web -type f \( -name '*.ts' -o -name '*.tsx' \) | grep -v '\.test\.' | grep -v '\.spec\.'; }

while IFS= read -r f; do
  # .limit(n) with n > 1 silently truncates rows — only .limit(1) / maybeSingle is allowed
  grep -nE '\.limit\([2-9][0-9]*\)' "$f" 2>/dev/null \
    | while IFS= read -r hit; do report "K42 $f: $hit"; done

  # a dynamic `.in("col", var)` must go through inChunks(…, 200)
  grep -nE '\.in\("[a-z_]+", [a-zA-Z]' "$f" 2>/dev/null | grep -v 'inChunks' \
    | while IFS= read -r hit; do report "K42 $f: $hit"; done
done < <(files)

exit "$fail"
