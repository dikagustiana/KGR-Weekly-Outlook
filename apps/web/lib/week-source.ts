import "server-only";
/**
 * PRD v6 R120 for the loaders shared by pages and builders (Kas, Komersial, Bulanan, master pages): the week's result
 * comes from week_snapshot when the caller's client reads snapshots (the request's session client, marked by the
 * RequestContext while `v6_snapshot_read` is on for the viewer's role), else it is computed as before (the rebuild worker
 * and the release always compute: they write the snapshot). The client decides, never a global: a builder handed the
 * service client keeps computing (Q-v5.2-51).
 */
import type { WeekResult } from "@kgr/engine";
import type { Supa } from "./supabase";
import { computeForWeek, fetchAll } from "./data";
import { readSnapshot } from "./snapshot";
import { weeksOf } from "./request-memo";

const readers = new WeakSet<object>();
const memo = new WeakMap<object, Map<string, Promise<WeekResult | null>>>();

/** Mark a client as a snapshot reader (RequestContext, flag on for the viewer). */
export function readSnapshotsWith(sb: Supa): void {
  readers.add(sb);
}

export const readsSnapshots = (sb: Supa): boolean => readers.has(sb);

/** The WeekResult of a week for this client: snapshot when it reads snapshots and a current one exists, else computed. */
export function weekResultOf(sb: Supa, weekStart: string): Promise<WeekResult | null> {
  if (!readers.has(sb)) return computeForWeek(sb, weekStart).then((c) => c?.result ?? null);
  let byWeek = memo.get(sb);
  if (!byWeek) memo.set(sb, (byWeek = new Map()));
  let p = byWeek.get(weekStart);
  if (!p) {
    const own = byWeek;
    p = (async () => {
      const week = (await weeksOf(sb)).find((w) => w.week_start === weekStart);
      if (!week) return null;
      const snap = await readSnapshot(sb, week.id);
      if (snap && snap.result.week.today === week.update_date) return snap.result;
      // K80: no current snapshot — computed here (the page that owns the week writes it; this loader only reads)
      return (await computeForWeek(sb, weekStart))?.result ?? null;
    })().catch((e: unknown) => { own.delete(weekStart); throw e; });
    own.set(weekStart, p);
  }
  return p;
}

/**
 * demand_status of the week's active sales lines by id (the monthly outlook values PO lines by it). From the loaded rows
 * when the week is computed anyway; one narrow read when the client reads snapshots.
 */
export async function salesDemandStatus(sb: Supa, weekStart: string): Promise<Map<string, string | null>> {
  const asStatus = (rows: Record<string, unknown>[]) => new Map(rows.map((r) => [String(r.id), r.demand_status === null || r.demand_status === undefined ? null : String(r.demand_status)]));
  if (!readers.has(sb)) {
    const c = await computeForWeek(sb, weekStart);
    return asStatus((c?.loaded.db.sales ?? []) as Record<string, unknown>[]); // missing-ok: minggu tanpa hasil = tidak ada baris penjualan, bukan angka
  }
  const week = (await weeksOf(sb)).find((w) => w.week_start === weekStart);
  if (!week) return new Map();
  return asStatus(await fetchAll<Record<string, unknown>>((a, b) => sb.from("sales_line").select("id, demand_status").eq("week_id", week.id)
    .is("deleted_at", null).is("superseded_at", null).order("id").range(a, b)));
}

/** The page's own read (week-result.ts) shared with the loaders of the same request. */
export function primeWeekResult(sb: Supa, weekStart: string, result: WeekResult): void {
  if (!readers.has(sb)) return;
  let byWeek = memo.get(sb);
  if (!byWeek) memo.set(sb, (byWeek = new Map()));
  if (!byWeek.has(weekStart)) byWeek.set(weekStart, Promise.resolve(result));
}
