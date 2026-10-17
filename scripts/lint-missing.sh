#!/usr/bin/env bash
# R64 (PRD v5.2-A): no `?? 0` / `?? "0"` / `|| 0` on money, kg or tariff — missing stays missing (null + "belum ada").
# Exits 1 on violation. The named whitelist keeps legitimate defaults (counts, indices, seq).
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
report() { echo "$1"; fail=1; }

files() { find apps/web -type f \( -name '*.ts' -o -name '*.tsx' \) | grep -v '\.test\.' | grep -v '\.spec\.'; }

# named whitelist: a default 0 that is NOT money/kg/tarif (counts, sums, chart numbers, guards)
WL='seq|index|length|count|sort_order|head_count|\.y\)|\.x\)|pos\.|reduce|toNumber|\.plus\(|\.gt\('

while IFS= read -r f; do
  grep -nE '\?\?\s*"?0"?[,)]|\|\|\s*0[,)]' "$f" 2>/dev/null \
    | grep -vE "$WL" \
    | while IFS= read -r hit; do report "MISSING $f: $hit"; done
done < <(files)

exit "$fail"
