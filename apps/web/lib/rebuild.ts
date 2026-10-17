import "server-only";
/**
 * Data mart rebuild (PRD v3 §3): rebuildDay(date) runs every registered builder whose module is on and writes the
 * engine's output into the *_daily tables through the mart_replace RPC (one scope = one date). Idempotent: running a
 * day twice writes nothing the second time. No external cron — the queue is processed after uploads and by the
 * "Bangun ulang" button on /admin/modul. The run uses the server's service-role client (PRD v4 S1): the caller has
 * already checked the user's role; the builders read the inputs from the database, never rows sent by the browser.
 */
import type { Supa } from "./supabase";
import { WriteError } from "./write";
import { clock, wallNow } from "./clock";
import { inChunks, mustRows } from "./loader";
import { addDays } from "@kgr/engine";
import { throughDates } from "./rebuild-dates";
import { REBUILD_NO_KEY, rebuildMode, type ModuleSettings } from "./modules-core";
import { supabaseService } from "./supabase-service";
import { orderedBuilders } from "./rebuild-registry";
// builders register themselves on import (no cycle: they import the registry, not this file)
import "./v3/ledger";
import "./v3/planning";
import "./v3/monthly";
import "./v3/cash";
import "./v3/commercial";
import "./v3/discount";
import "./v4/week-pl";
import "./v4/month";
import "./v4/uploads-month";
import "./v4/uploads-ppic";
import "./v4/close";
import "./v5/ppic-data";
import "./v5/input-data";

export { registerBuilder, BUILDERS, martReplace, type Builder } from "./rebuild-registry";
export { throughDates, QUEUE_THROUGH_MAX_DAYS } from "./rebuild-dates";

/** Rebuilds run for every module whose flag is enabled, whatever the role list (the data mart is shared). */
export function moduleSettingsGlobal(s: ModuleSettings): ModuleSettings {
  const out: ModuleSettings = {};
  for (const [k, v] of Object.entries(s)) out[k as keyof ModuleSettings] = v ? { enabled: v.enabled, roles: null } : v;
  return out;
}

export async function rebuildDay(sb: Supa, date: string, settings: ModuleSettings): Promise<string[]> {
  const out: string[] = [];
  for (const b of orderedBuilders()) {
    if (!settings[b.module]?.enabled || (b.unless && settings[b.unless]?.enabled)) continue;
    out.push(`${b.name}: ${await b.build(sb, date)}`);
  }
  return out;
}

export async function queueRebuild(sb: Supa, dates: string[], reason: string): Promise<void> {
  const uniq = [...new Set(dates.filter(Boolean))];
  if (!uniq.length) return;
  // K41 / K42: a failing read is an error, not "nothing queued"; the dates go in chunks of 200
  const queued = await inChunks(uniq, async (part) => mustRows<{ date: string }>(await sb.from("rebuild_queue").select("date").eq("status", "queued").in("date", part), "queueRebuild"));
  const have = new Set(queued.map((r) => r.date));
  const rows = uniq.filter((d) => !have.has(d)).map((date) => ({ date, reason }));
  if (rows.length) {
    const { error } = await sb.from("rebuild_queue").insert(rows);
    if (error) throw new WriteError(`rebuild_queue: ${error.message}`);
  }
}

/** K40: queue the affected dates through the data date (clock().data). Returns the dates queued. */
export async function queueThrough(sb: Supa, affected: string[], reason: string): Promise<string[]> {
  const dates = throughDates(affected, (await clock(sb)).data);
  await queueRebuild(sb, dates, reason);
  return dates;
}

/**
 * queueThrough after the rows are saved (uploads): a range over 62 days is returned as a sentence for the upload
 * message, so the saved upload is not reported as failed; Admin rebuilds that range by hand.
 */
export async function queueThroughNote(sb: Supa, affected: string[], reason: string): Promise<string> {
  try {
    await queueThrough(sb, affected, reason);
    return "";
  } catch (e) {
    if (!(e instanceof WriteError) || !e.message.includes("rebuild manual")) throw e;
    return ` Rebuild tidak diantrekan: ${e.message}.`;
  }
}

/** R45 (K61): inline processing from an action is capped to this many dates; the rest stays queued for the cron. */
export const REBUILD_INLINE_MAX = 7;

/**
 * Process queued dates oldest first (each date once), marking every row done or failed. With every module off the
 * queue is left alone: a v1 upload then works on a database without the v3 migrations (no rebuild_queue table yet).
 * Without the server key the queue is left alone too, with a note saying why. K61 (R45): stuck `running` rows are
 * reset, out-of-window dates are marked done, and inline processing is capped; the rest is left for the cron.
 */
export async function processRebuildQueue(settings: ModuleSettings, opts: { limit?: number; budgetMs?: number } = {}): Promise<{ done: number; failed: number; notes: string[] }> {
  const { limit = REBUILD_INLINE_MAX, budgetMs = 0 } = opts;
  const svc = supabaseService();
  const mode = rebuildMode(settings, svc !== null);
  if (mode === "skip") return { done: 0, failed: 0, notes: [] };
  if (mode === "no_key" || !svc) return { done: 0, failed: 0, notes: [REBUILD_NO_KEY] };
  const sb = svc;

  // K61 (R45): a crashed run leaves `running` rows that would block STALE forever — reset them after 15 minutes.
  const stuck = await sb.from("rebuild_queue").update({ status: "queued", error: "direset: running > 15 menit" }).eq("status", "running").lt("started_at", new Date(Date.now() - 15 * 60_000).toISOString());
  if (stuck.error) throw new WriteError(`rebuild_queue reset running: ${stuck.error.message}`);

  // K61 (R45): dates beyond the data window (wall clock + 7) are marked done, never built.
  const beyond = addDays(wallNow().date, 7);
  const outWin = await sb.from("rebuild_queue").update({ status: "done", finished_at: new Date().toISOString(), error: "di luar jendela data (jam dinding + 7); tidak dibangun" }).eq("status", "queued").gt("date", beyond);
  if (outWin.error) throw new WriteError(`rebuild_queue luar jendela: ${outWin.error.message}`);

  const { data, error } = await sb.from("rebuild_queue").select("id, date").eq("status", "queued").order("date").limit(500);
  if (error) throw new WriteError(error.message);
  const rows = (data as { id: string; date: string }[]);
  const byDate = new Map<string, string[]>();
  for (const r of rows) byDate.set(r.date, [...(byDate.get(r.date) ?? []), r.id]);
  let done = 0, failed = 0;
  const notes: string[] = [];
  if (byDate.size) for (const b of orderedBuilders()) if (settings[b.module]?.enabled && !(b.unless && settings[b.unless]?.enabled) && b.begin) await b.begin(sb);
  // K42: the ids of one date in chunks of 200 (URL length); the first error message, or null
  const mark = async (ids: string[], patch: Record<string, string>): Promise<string | null> => {
    for (let i = 0; i < ids.length; i += 200) {
      const r = await sb.from("rebuild_queue").update(patch).in("id", ids.slice(i, i + 200));
      if (r.error) return r.error.message;
    }
    return null;
  };
  const startedAt = Date.now();
  let processed = 0;
  for (const [date, ids] of [...byDate.entries()].slice(0, limit)) {
    if (budgetMs && Date.now() - startedAt > budgetMs) break;
    const fail = await mark(ids, { status: "running", started_at: new Date().toISOString() });
    if (fail) throw new WriteError(`rebuild_queue running: ${fail}`);
    try {
      const msg = await rebuildDay(sb, date, settings);
      const finFail = await mark(ids, { status: "done", finished_at: new Date().toISOString(), error: msg.length ? msg.join("; ").slice(0, 2000) : "tidak ada modul aktif" });
      if (finFail) throw new WriteError(`rebuild_queue done: ${finFail}`);
      done += ids.length;
      processed += 1;
      notes.push(`${date}: ${msg.length ? msg.join("; ") : "tidak ada modul aktif"}`);
    } catch (e) {
      const f = await mark(ids, { status: "failed", finished_at: new Date().toISOString(), error: (e as Error).message.slice(0, 2000) });
      if (f) notes.push(`${date}: GAGAL menandai failed: ${f}`);
      failed += ids.length;
      processed += 1;
      notes.push(`${date}: GAGAL ${(e as Error).message}`);
    }
  }
  if (byDate.size > processed) notes.push(`${byDate.size - processed} tanggal tersisa di antrean; dilanjutkan otomatis`);
  return { done, failed, notes };
}
