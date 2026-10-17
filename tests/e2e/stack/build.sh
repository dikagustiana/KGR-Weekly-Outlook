#!/usr/bin/env bash
# `next build` of apps/web for the e2e stack: NEXT_PUBLIC_SUPABASE_URL = the mock Supabase origin, the anon key = a JWT
# signed with the fixed TEST secret. NEXT_PUBLIC_* is inlined at build time, so a build is tied to one URL/key; the
# stamp apps/web/.next/e2e-supa-url records which. CI runs this as its own step, then run.sh with E2E_BUILD=never.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
mkdir -p "$E2E_WORK"
if [[ -z "${E2E_ANON_KEY:-}" ]]; then
  node "$E2E_HERE/keys.mjs" env >"$E2E_WORK/keys.env"
  # shellcheck disable=SC1091
  source "$E2E_WORK/keys.env"
fi
e2e_log "[build] next build (NEXT_PUBLIC_SUPABASE_URL=$E2E_SUPA_URL)"
(
  cd "$E2E_ROOT/apps/web"
  NEXT_PUBLIC_SUPABASE_URL="$E2E_SUPA_URL" NEXT_PUBLIC_SUPABASE_ANON_KEY="$E2E_ANON_KEY" NEXT_TELEMETRY_DISABLED=1 \
    "$E2E_ROOT/apps/web/node_modules/.bin/next" build
  printf '%s' "$E2E_SUPA_URL|$E2E_ANON_KEY" > .next/e2e-supa-url
)
e2e_log "[build] selesai"
