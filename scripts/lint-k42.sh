#!/usr/bin/env bash
# K42 (PRD v5.2-A R47): stable pagination (fetchAll ordered by a unique key) and chunked `.in()`. Exits 1 on violation
# (rules and markers: scripts/lint.py).
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 -I scripts/lint.py k42 "$@"
