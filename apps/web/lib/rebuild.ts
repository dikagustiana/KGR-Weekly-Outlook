import "server-only";
/**
 * Data mart rebuild (PRD v3 §3): rebuildDay(date) runs every registered builder whose module is on and writes the
 * engine's output into the *_daily tables through the mart_replace RPC (one scope = one date). Idempotent: running a
 * day twice writes nothing the second time. No external cron — the queue is processed after uploads and by the
 * "Bangun ulang" button on /admin/modul.
 */
import type { Supa } from "./supabase";
import { WriteError } from "./write";
import type { ModuleSettings } from "./modules-core";
import { BUILDERS } from "./rebuild-registry";
// builders register themselves on import (no cycle: they import the registry, not this file)
import "./v3/ledger";
import "./v3/planning";
import "./v3/monthly";
import "./v3/cash";
import "./v3/commercial";
import "./v3/discount";

export { registerBuilder, BUILDERS, martReplace, type Builder } from "./rebuild-registry";

/** Rebuilds run for every module whose flag is enabled, whatever the role list (the data mart is shared). */
export function moduleSettingsGlobal(s: ModuleSettings): ModuleSettings {
  const out: ModuleSettings = {};
  for (const [k, v] of Object.entries(s)) out[k as keyof ModuleSettings] = v ? { enabled: v.enabled, roles: null } : v;
  return out;
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
  if (byDate.size) for (const b of BUILDERS) if (settings[b.module]?.enabled && b.begin) await b.begin(sb);
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
