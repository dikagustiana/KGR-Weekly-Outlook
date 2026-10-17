#!/usr/bin/env bash
# K41/K56 (PRD v5.2-A R43): a read must never swallow a PostgREST error and read as "no rows / not strict".
# Exits 1 when any offending line is found (rules and markers: scripts/lint.py).
set -euo pipefail
cd "$(dirname "$0")/.."
exec python3 -I scripts/lint.py k41 "$@"
