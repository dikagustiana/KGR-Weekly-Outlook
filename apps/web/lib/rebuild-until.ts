import "server-only";
/**
 * Q-v5.2-52 (A5 finding): C45 STALE holds PPIC's allocation until the queue is rebuilt, and a WP, an invoice or a posting can
 * leave more dates in the queue than one inline run takes (REBUILD_INLINE_MAX, R45). PPIC drains it from the allocation screen:
 * the queued dates up to the date on the screen, oldest first, in one run — the same `processRebuildQueue` that Finance's
 * "Perbarui status tugas" and the cron use (it builds with the service client; `mart_replace` is not granted to a session). The
 * role is checked by the action that calls this; the schema must be current (K57: a rebuild never runs against a schema that is
 * behind the code, `assertSchemaCurrent`).
 */
import type { Supa } from "./supabase";
import { mustRows } from "./loader";
import { processRebuildQueue } from "./rebuild";
import type { ModuleSettings } from "./modules-core";
import { assertSchemaCurrent } from "./schema";

/** At most this many dates in one press, and this long: a press that does not finish says how many are left. */
export const REBUILD_UNTIL_MAX_DATES = 60;
export const REBUILD_UNTIL_BUDGET_MS = 40_000;

export async function rebuildQueueUntil(sb: Supa, settings: ModuleSettings, date: string): Promise<{ queued: number; done: number; failed: number; left: number; notes: string[] }> {
  await assertSchemaCurrent(sb);
  const rows = mustRows<{ date: string }>(await sb.from("rebuild_queue").select("date").eq("status", "queued").lte("date", date).order("date").limit(500), "rebuildQueueUntil.rebuild_queue");
  const dates = [...new Set(rows.map((r) => String(r.date)))];
  if (!dates.length) return { queued: 0, done: 0, failed: 0, left: 0, notes: [] };
  // oldest first: the first `n` distinct dates of the queue are exactly the dates up to `date`
  const n = Math.min(dates.length, REBUILD_UNTIL_MAX_DATES);
  const r = await processRebuildQueue(settings, { limit: n, budgetMs: REBUILD_UNTIL_BUDGET_MS });
  return { queued: dates.length, done: r.done, failed: r.failed, left: Math.max(0, dates.length - n), notes: r.notes };
}
