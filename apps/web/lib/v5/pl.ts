import "server-only";
/**
 * PRD v5 §4.7 K29 on the server (flag v5_pl): the fixed-cost nominal of the month — the Finance schedule (template 8.3,
 * fixed_cost_schedule), a line without an amount from the last FINAL month's journal ("estimasi bulan lalu") — and the
 * rows "Beban tetap belum dijurnal" (basis fixed_estimate) from @kgr/engine, with C55. The month builder writes them to
 * pl_daily_v4; pages read the mart.
 */
import {
  actualRowsV4, c55, fixedEstimateRows, fixedNominals, lineTotals, monthEnd,
  type ControlV3, type FixedCostRow, type FixedNominal, type PlRowV4,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import { fetchAll } from "../data";
import { must } from "../loader";
import { costingModeOf, type CostingRowsMode, type ModuleSettings } from "../modules-core";
import type { Row } from "../v3/uploads";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));

/** R66 (K63): the costing-rows mode stored in app_setting v5_pl ('cogs' without a value). A failed read throws (K41). */
export async function v5CostingMode(sb: Supa): Promise<CostingRowsMode> {
  const data = must(await sb.from("app_setting").select("value").eq("key", "v5_pl").maybeSingle(), "app_setting v5_pl") as Row | null;
  return costingModeOf(data?.value);
}

/** The mode that applies to a builder or page: only while v5_pl is on; with it off the v5 rows are not shown and the v4 totals stay as they were. */
export async function costingModeFor(sb: Supa, settings: ModuleSettings): Promise<CostingRowsMode> {
  return settings.v5_pl?.enabled ? v5CostingMode(sb) : "cogs";
}

/** P&L lines of the last month before `before` that has a FINAL version (its journal per line), or null. */
export async function lastFinalLines(sb: Supa, before: string): Promise<{ month: string; byLine: Record<string, string> } | null> {
  const fins = await fetchAll<Row>((a, b) => sb.from("month_outlook_version").select("version, month_outlook!inner(month)").eq("version", "FINAL").order("id").range(a, b));
  const months = fins.map((f) => s((f.month_outlook as Row | null)?.month)).filter((m): m is string => !!m && m < before).sort();
  const m = months[months.length - 1];
  if (!m) return null;
  const last = monthEnd(m);
  const [gl, coa] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("gl_line").select("date, account, debit, credit").is("deleted_at", null).gte("date", m).lte("date", last).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("coa_map").select("account, pl_line, segment").is("deleted_at", null).order("account").range(a, b)),
  ]);
  if (!gl.length) return null;
  const rows = actualRowsV4({
    gl: gl.map((g) => ({ date: s(g.date), account: s(g.account), debit: s(g.debit), credit: s(g.credit) })),
    coa: coa.map((c) => ({ account: String(c.account), pl_line: s(c.pl_line), segment: s(c.segment) })), from: m, to: last,
  });
  return { month: m, byLine: lineTotals(rows) };
}

export async function fixedSchedule(sb: Supa): Promise<FixedCostRow[]> {
  const sched = await fetchAll<Row>((a, b) => sb.from("fixed_cost_schedule").select("*").is("deleted_at", null).order("pl_line").order("start_date").order("id").range(a, b));
  return sched.map((r) => ({
    id: String(r.id), code: s(r.code), pl_line: String(r.pl_line), description: String(r.description ?? ""), amount_per_month: s(r.amount_per_month),
    start_date: String(r.start_date), end_date: s(r.end_date), amortize: r.amortize === true, prepaid_total: s(r.prepaid_total), active: r.active === true,
    day_basis: r.day_basis === "working" ? "working" : "calendar", account: s(r.account),
  }));
}

export interface V5Fixed { nominals: FixedNominal[]; rows: PlRowV4[]; control: ControlV3 }

/** K29 for a month: nominals, the fixed_estimate rows against what the plan rows already carry, and C55. */
export async function v5FixedForMonth(sb: Supa, first: string, cutOff: string, planRows: PlRowV4[], isWorkingDay: (d: string) => boolean): Promise<V5Fixed> {
  const [schedule, lastFinal] = await Promise.all([fixedSchedule(sb), lastFinalLines(sb, first)]);
  const nominals = fixedNominals({ month: first, schedule, lastFinal, isWorkingDay });
  return { nominals, rows: fixedEstimateRows({ month: first, cutOff, nominals, rows: planRows }), control: c55({ month: first, nominals }) };
}

/** What the month builder records with the lock pre-flight for the page (cara hitung, labels). */
export const fixedSourcesOf = (n: FixedNominal[]) => n.map((x) => ({ pl_line: x.pl_line, nominal: x.nominal?.toFixed(2) ?? null, source: x.source, finalMonth: x.finalMonth }));
