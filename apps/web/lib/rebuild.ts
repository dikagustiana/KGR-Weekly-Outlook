import "server-only";
/**
 * Data mart rebuild (PRD v3 §3): rebuildDay(date) runs every registered builder whose module is on and writes the
 * engine's output into the *_daily tables through the mart_replace RPC (one scope = one date). Idempotent: running a
 * day twice writes nothing the second time. No external cron — the queue is processed after uploads and by the
 * "Bangun ulang" button on /admin/modul.
 */
import type { Supa } from "./supabase";
import { WriteError } from "./write";
import type { ModuleKey, ModuleSettings } from "./modules-core";

export interface Builder {
  module: ModuleKey;
  name: string;
  /** Build one date; returns a short summary for the queue row. */
  build: (sb: Supa, date: string) => Promise<string>;
}

/** Registered per module (later phases add theirs here). */
export const BUILDERS: Builder[] = [];

export function registerBuilder(b: Builder): void {
  if (!BUILDERS.some((x) => x.module === b.module && x.name === b.name)) BUILDERS.push(b);
}

/** Write one scope of a data mart table (rows = engine output, already plain JSON). */
export async function martReplace(sb: Supa, table: string, scope: string, rows: Record<string, unknown>[]): Promise<{ written: number; deleted: number }> {
  const { data, error } = await sb.rpc("mart_replace", { p_table: table, p_scope: scope, p_rows: rows });
  if (error) throw new WriteError(`${table} ${scope}: ${error.message}`);
  return data as { written: number; deleted: number };
}

export async function rebuildDay(sb: Supa, date: string, settings: ModuleSettings): Promise<string[]> {
  const out: string[] = [];
  for (const b of BUILDERS) {
    if (!settings[b.module]?.enabled) continue;
    out.push(`${b.name}: ${await b.build(sb, date)}`);
  }
  return out;
}

export async function queueRebuild(sb: Supa, dates: string[], reason: string): Promise<void> {
  const uniq = [...new Set(dates.filter(Boolean))];
  if (!uniq.length) return;
  const { data } = await sb.from("rebuild_queue").select("date").eq("status", "queued").in("date", uniq);
  const have = new Set((data ?? []).map((r: { date: string }) => r.date));
  const rows = uniq.filter((d) => !have.has(d)).map((date) => ({ date, reason }));
  if (rows.length) {
    const { error } = await sb.from("rebuild_queue").insert(rows);
    if (error) throw new WriteError(`rebuild_queue: ${error.message}`);
  }
}

/** Process queued dates oldest first (each date once), marking every row done or failed. */
export async function processRebuildQueue(sb: Supa, settings: ModuleSettings, limit = 62): Promise<{ done: number; failed: number; notes: string[] }> {
  const { data, error } = await sb.from("rebuild_queue").select("id, date").eq("status", "queued").order("date").limit(500);
  if (error) throw new WriteError(error.message);
  const rows = (data ?? []) as { id: string; date: string }[];
  const byDate = new Map<string, string[]>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r.id]);
  let done = 0, failed = 0;
  const notes: string[] = [];
  for (const [date, ids] of [...byDate.entries()].slice(0, limit)) {
    await sb.from("rebuild_queue").update({ status: "running", started_at: new Date().toISOString() }).in("id", ids);
    try {
      const msg = await rebuildDay(sb, date, settings);
      await sb.from("rebuild_queue").update({ status: "done", finished_at: new Date().toISOString(), error: msg.length ? msg.join("; ").slice(0, 2000) : "tidak ada modul aktif" }).in("id", ids);
      done += ids.length;
      notes.push(`${date}: ${msg.length ? msg.join("; ") : "tidak ada modul aktif"}`);
    } catch (e) {
      await sb.from("rebuild_queue").update({ status: "failed", finished_at: new Date().toISOString(), error: (e as Error).message.slice(0, 2000) }).in("id", ids);
      failed += ids.length;
      notes.push(`${date}: GAGAL ${(e as Error).message}`);
    }
  }
  return { done, failed, notes };
}
