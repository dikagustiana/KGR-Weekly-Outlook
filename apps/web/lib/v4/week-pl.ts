import "server-only";
/**
 * Weekly rows of the data mart pl_daily_v4 (PRD v4 §3.4, K17): the rebuild job computes the week that contains the
 * queued date with @kgr/engine computeWeek and writes weekPlDaily for each of its 7 days (one scope = one date).
 * Pages read the mart; they never sum journal lines themselves. Flag v4_design (irisan 1).
 */
import { addDays, computeWeek, mondayOf, plRowsByKey, plRowsToMart, weekPlDaily } from "@kgr/engine";
import type { Supa } from "../supabase";
import { fetchAll, loadWeek } from "../data";
import { martReplace, registerBuilder } from "../rebuild-registry";
import { v5CostingPlRows } from "../v5/costing-pl";
import { v5CostingMode } from "../v5/pl";
import { isModuleOn, type CostingRowsMode, type ModuleSettings } from "../modules-core";
import type { Role } from "../roles";

let built = new Set<string>();

export async function buildWeekPl(sb: Supa, date: string): Promise<string> {
  const ws = mondayOf(date);
  if (built.has(ws)) return `minggu ${ws} sudah dibangun`;
  built.add(ws);
  const loaded = await loadWeek(sb, ws);
  if (!loaded) return `minggu ${ws} belum ada`;
  const v5 = await v5CostingPlRows(sb, ws, addDays(ws, 6), addDays(loaded.week.update_date, -1));
  const rows = plRowsToMart(plRowsByKey([...weekPlDaily(computeWeek(loaded.inputs)), ...v5]));
  let written = 0, deleted = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    const w = await martReplace(sb, "pl_daily_v4", d, rows.filter((r) => r.date === d));
    written += w.written;
    deleted += w.deleted;
  }
  return `pl_daily_v4 minggu ${ws}: ${rows.length} baris (${written} ditulis, ${deleted} dihapus)`;
}

registerBuilder({ module: "v4_design", unless: "m4_monthly", name: "pl minggu", begin: async () => { built = new Set(); }, build: buildWeekPl });

/** Rows of the week for the management view (the 7 days of the week); every page of them (K42), errors thrown (K41). */
export async function weekPlRows(sb: Supa, weekStart: string): Promise<Record<string, unknown>[]> {
  return fetchAll<Record<string, unknown>>((a, b) => sb.from("pl_daily_v4").select("date, segment, pl_line, basis, actual, forecast, kg, anomaly")
    .gte("date", weekStart).lte("date", addDays(weekStart, 6)).order("date").order("segment").order("pl_line").order("basis").range(a, b));
}

/**
 * R66 (K63): how the two v5 costing rows count in the journal columns of the weekly P&L the viewer sees. The rows of the week
 * are written the same in both modes (the builder above); the mode is applied when totals are made from them, so the weekly
 * view and the month view read one setting. 'cogs' unless v5_pl is on for the role and the setting says 'memo'.
 */
export async function weekPlMode(sb: Supa, settings: ModuleSettings, role: Role): Promise<CostingRowsMode> {
  return isModuleOn(settings.v5_pl, role) ? v5CostingMode(sb) : "cogs";
}
