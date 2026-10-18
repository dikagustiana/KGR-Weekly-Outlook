#!/usr/bin/env bash
# Database snapshots of the e2e stack, so every journey starts from the same prepared state (PRD v5.2-A R70):
#   snapshot.sh save <name>      pg_dump of $E2E_DB + the fake clock + (nothing else: storage is cleared on restore)
#   snapshot.sh restore <name>   drop and recreate $E2E_DB from the dump, restart PostgREST, reset the clock and the object store
# The database lives in the throwaway cluster of up.sh; nothing here can reach another database.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/env.sh"
cmd="${1:?usage: snapshot.sh save|restore <name>}"; name="${2:?name}"
dump="$E2E_WORK/snapshot-$name.dump"
admin_url="postgresql://postgres@127.0.0.1:$E2E_PG_PORT/postgres"
case "$cmd" in
  save)
    LD_PRELOAD= "$E2E_PG_BIN/pg_dump" -Fc -f "$dump" "$E2E_PG_URL"
    cp "$E2E_CLOCK_FILE" "$E2E_WORK/snapshot-$name.clock"
    echo "snapshot '$name': $(du -h "$dump" | cut -f1), jam uji $("$E2E_HERE/clock.sh" now)"
    ;;
  restore)
    [[ -f "$dump" ]] || { echo "snapshot '$name' belum ada" >&2; exit 1; }
    # stop PostgREST first: it keeps connections open
    if [[ -f "$E2E_WORK/pids/postgrest.pid" ]]; then kill "$(cat "$E2E_WORK/pids/postgrest.pid")" 2>/dev/null || true; sleep 0.3; fi
    psql "$admin_url" -q -c "drop database if exists $E2E_DB with (force)" -c "create database $E2E_DB"
    LD_PRELOAD= "$E2E_PG_BIN/pg_restore" --no-owner -d "$E2E_PG_URL" "$dump" 2>"$E2E_WORK/log/restore.err" || { grep -v "^$" "$E2E_WORK/log/restore.err" | head -5 >&2; }
    install -m 644 "$E2E_WORK/snapshot-$name.clock" "$E2E_CLOCK_FILE"
    rm -rf "$E2E_WORK/storage"; mkdir -p "$E2E_WORK/storage"
    setsid nohup "$E2E_PGRST_BIN" "$E2E_WORK/postgrest.conf" >>"$E2E_WORK/log/postgrest.log" 2>&1 </dev/null &
    echo $! >"$E2E_WORK/pids/postgrest.pid"
    for _ in $(seq 1 50); do curl -s -o /dev/null --max-time 1 "http://127.0.0.1:$E2E_PGRST_PORT/" && break; sleep 0.2; done
    sleep 1.3
    echo "snapshot '$name' dipulihkan: jam uji $("$E2E_HERE/clock.sh" now)"
    ;;
  *) echo "usage: snapshot.sh save|restore <name>" >&2; exit 2 ;;
esac
