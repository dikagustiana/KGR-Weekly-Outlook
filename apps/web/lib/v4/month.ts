import "server-only";
/**
 * M4 v4 on the server (PRD v4 §3.2 P1–P14): loads the month (journal, PO lines of the computed weeks, DOs not yet
 * invoiced, M5 template 8.3 rows, cost events, budget, register), runs @kgr/engine (monthPlanV4, monthSummaryV4,
 * engineAssumptions, runrateTest, lockBlockers, bridgeV4, c49), and writes the data mart pl_daily_v4, the register of
 * assumptions and the lock pre-flight. Pages read the mart (K17); the only place that computes is the rebuild job
 * and the lock action, both through the engine.
 */
import { createHash } from "node:crypto";
import {
  D, actualRowsV4, addDays, bridgeV4, c32, c49, firstOfMonth, holidaysFromJournal, jakartaToday, lockBlockers, monthEnd, monthPlanV4, monthSummaryV4,
  ordersV4FromWeek, plRowsToMart, runrateActualLines, runrateTest, toFixedString, totalsV4, unbilledFromWeek, v1LockDate, versionDaysV4,
  engineAssumptions,
  type BridgeV4, type BudgetRow, type ControlV3, type CostEventRow, type LockBlocker, type MonthPlanV4, type MonthSummaryV4, type OpexInputV4, type PlRowV4,
  type RegisterRow, type RunrateTest, type VersionDayV4,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import { computeForWeek, fetchAll, listWeeks } from "../data";
import { WriteError } from "../write";
import { martReplace, registerBuilder } from "../rebuild-registry";
import type { ModuleSettings } from "../modules-core";
import { loadMonthDrivers, type MonthDrivers } from "../v3/drivers";
import { isWorkingDay } from "../v3/monthly";
import type { Row } from "../v3/uploads";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const f2 = (x: { toFixed(n: number): string } | null) => (x === null ? null : x.toFixed(2));

export interface MonthStateV4 {
  first: string;
  last: string;
  cutOff: string;
  today: string;
  tolerance: string;
  lockWeek: number;
  lockDate: string;
  windowDays: number;
  plan: MonthPlanV4;
  summary: MonthSummaryV4;
  register: RegisterRow[];
  test: RunrateTest[];
  controls: ControlV3[];
  blockers: LockBlocker[];
  holidays: string[];
  drivers: MonthDrivers | null;
  budget: BudgetRow[];
  events: CostEventRow[];
}

/** Cut-off: the month_outlook override, else yesterday for the running month, else the month end (as the v3 rule). */
function cutOffOf(first: string, today: string, override: string | null): string {
  if (override) return override;
  const last = monthEnd(first);
  const yday = addDays(today, -1);
  return yday < first ? addDays(first, -1) : yday < last ? yday : last;
}

/**
 * Register rows the engine proposes, with what Finance already agreed kept (same code, same value), followed by the
 * rows the engine does not own (manual, kalibrasi from the previous FINAL): P10 needs every live row agreed, and
 * public.release_month counts them all.
 */
export function mergeRegister(engine: RegisterRow[], saved: Row[]): RegisterRow[] {
  const codes = new Set(engine.map((e) => e.code));
  const others: RegisterRow[] = saved
    .filter((r) => String(r.source) !== "engine" && String(r.status) !== "superseded" && s(r.version) === null && !codes.has(String(r.code)))
    .map((r) => ({
      code: String(r.code), name: String(r.name), value_num: s(r.value_num), value_text: s(r.value_text), basis: s(r.basis), owner: s(r.owner),
      agreed_at: s(r.agreed_at), deviation_note: s(r.deviation_note), status: String(r.status) as RegisterRow["status"],
    }));
  return [...mergeEngine(engine, saved), ...others];
}

function mergeEngine(engine: RegisterRow[], saved: Row[]): RegisterRow[] {
  return engine.map((e) => {
    const o = saved.find((r) => String(r.code) === e.code && String(r.status) !== "superseded" && s(r.version) === null);
    if (!o) return e;
    const same = (o.value_num === null || o.value_num === undefined ? null : D(String(o.value_num)).toFixed(6)) === (e.value_num === null ? null : D(e.value_num).toFixed(6)) && s(o.value_text) === e.value_text;
    if (!same) return e;
    return { ...e, status: String(o.status) as RegisterRow["status"], owner: s(o.owner) ?? e.owner, agreed_at: s(o.agreed_at), deviation_note: s(o.deviation_note) ?? e.deviation_note };
  });
}

export async function computeMonthV4(sb: Supa, monthFirst: string, today: string, settings: ModuleSettings, opts: { cutOff?: string } = {}): Promise<MonthStateV4> {
  const first = firstOfMonth(monthFirst), last = monthEnd(first);
  const { data: mo } = await sb.from("month_outlook").select("*").eq("month", first).maybeSingle();
  const outlook = (mo as Row | null) ?? null;
  // FINAL passes the month end: the cut-off override of the month is for V1 / V2 only
  const cutOff = opts.cutOff ?? cutOffOf(first, today, s(outlook?.cut_off_date));
  const from = addDays(cutOff, -42) < first ? addDays(cutOff, -42) : first;
  const [gl, coa, evRows] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("gl_line").select("date, account, debit, credit").is("deleted_at", null).gte("date", from).lte("date", cutOff).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("coa_map").select("account, pl_line, segment").is("deleted_at", null).range(a, b)),
    fetchAll<Row>((a, b) => sb.from("cost_event").select("date, pl_line, amount").is("deleted_at", null).gte("date", first).lte("date", last).range(a, b)),
  ]);
  const glRows = gl.map((g) => ({ date: s(g.date), account: s(g.account), debit: s(g.debit), credit: s(g.credit) }));
  const coaRows = coa.map((c) => ({ account: String(c.account), pl_line: s(c.pl_line), segment: s(c.segment) }));
  // cost events are entered as a positive cost; the P&L rows are negative (Other Income stays positive)
  const events: CostEventRow[] = evRows.map((e) => ({ date: String(e.date), pl_line: String(e.pl_line), amount: String(e.pl_line) === "Other Income" ? String(e.amount) : D(String(e.amount)).neg().toString() }));

  // oldest first: the parameters (tolerance, v1_lock_week, window) and the run-rate table are those of the month's last
  // week, as public.release_month reads v1_lock_week (listWeeks returns the newest first)
  const weeks = (await listWeeks(sb)).filter((w) => w.week_end >= first && w.week_start <= last).sort((a, b) => a.week_start.localeCompare(b.week_start));
  const orders: ReturnType<typeof ordersV4FromWeek> = [];
  const unbilled: ReturnType<typeof unbilledFromWeek> = [];
  let tolerance = "0.10", lockWeek = 3, windowDays = 7, wT = "0.7", wF = "0.5";
  let pnlMtd: { revenue: string; cogs: string; gp: string } | null = null;
  for (const w of weeks) {
    const c = await computeForWeek(w.week_start);
    if (!c) continue;
    const status = new Map((c.loaded.db.sales as Row[]).map((r) => [String(r.id), s(r.demand_status)]));
    const { data: p } = await sb.from("parameter").select("*").eq("week_id", w.id).maybeSingle();
    const pr = (p ?? {}) as Row;
    tolerance = s(pr.forecast_tolerance_pct) ?? tolerance; lockWeek = Number(pr.v1_lock_week ?? lockWeek); windowDays = Number(pr.runrate_window_days ?? windowDays);
    wT = s(pr.tentative_weight) ?? wT; wF = s(pr.forecast_weight) ?? wF;
    const lo = addDays(cutOff, 1) > w.week_start ? addDays(cutOff, 1) : w.week_start;
    const hi = last < w.week_end ? last : w.week_end;
    if (lo <= hi) orders.push(...ordersV4FromWeek(c.result.sales, lo, hi, (id) => { const st = id ? status.get(id) : null; return st === "Tentative" ? wT : st === "Forecast" ? wF : "1"; }));
    const ulo = first > w.week_start ? first : w.week_start, uhi = cutOff < w.week_end ? cutOff : w.week_end;
    if (ulo <= uhi) unbilled.push(...unbilledFromWeek(c.result.sales, ulo, uhi));
    // C49: the weekly P&L whose update date is the day after the cut-off carries the month to date up to the cut-off
    if (w.update_date === addDays(cutOff, 1)) {
      const v = (l: string) => c.result.statements.pnl.get(l).values.mtd.toFixed(2);
      pnlMtd = { revenue: v("TOTAL REVENUE"), cogs: v("TOTAL COST OF SALES"), gp: v("GROSS PROFIT") };
    }
  }
  const actualRows = actualRowsV4({ gl: glRows, coa: coaRows, from, to: cutOff, unbilled });
  const holidays = holidaysFromJournal(actualRows, from, cutOff, isWorkingDay);

  const drivers = settings.m5_drivers?.enabled ? await loadMonthDrivers(sb, first, addDays(cutOff, 1)) : null;
  const lastWeek = weeks[weeks.length - 1];
  const rrTable = lastWeek ? ((await sb.from("runrate").select("pl_line, monthly_amount").eq("week_id", lastWeek.id)).data ?? []) as Row[] : [];
  const opex: OpexInputV4 = {
    fixed: (drivers?.fixed ?? []).map((f) => ({ pl_line: f.pl_line, scheduled: f.scheduled, actual_mtd: f.actual_mtd, day_basis: f.day_basis, missing: f.missing.length > 0 })),
    runrateActual: runrateActualLines({ gl: glRows, coa: coaRows, from: first, to: cutOff, events }),
    runrateTable: rrTable.map((r) => ({ pl_line: String(r.pl_line), monthly: String(r.monthly_amount ?? 0) })),
    variable: drivers ? drivers.coa.filter((c) => c.driver_type === "variable" && c.rp_per_kg !== null && c.rp_per_kg !== undefined).map((c) => ({ pl_line: String(c.pl_line), rp_per_kg: String(c.rp_per_kg) })) : [],
    events: events.filter((e) => e.date > cutOff),
  };
  const plan = monthPlanV4({ month: first, cutOff, actualRows, orders, opex, isWorkingDay, holidays, windowDays });
  const summary = monthSummaryV4(plan.rows, first, tolerance, isWorkingDay);

  const [saved, budgetRows] = await Promise.all([
    outlook ? fetchAll<Row>((a, b) => sb.from("assumption_register").select("*").eq("month_outlook_id", String(outlook.id)).is("deleted_at", null).range(a, b)) : Promise.resolve([] as Row[]),
    fetchAll<Row>((a, b) => sb.from("budget").select("version, segment, metric, value").eq("month", first).is("deleted_at", null).range(a, b)),
  ]);
  const latestV = budgetRows.reduce((m, r) => Math.max(m, Number(r.version)), 0);
  const budget: BudgetRow[] = budgetRows.filter((r) => Number(r.version) === latestV).map((r) => ({ segment: String(r.segment), metric: String(r.metric) as BudgetRow["metric"], value: String(r.value) }));

  const register = mergeRegister(engineAssumptions({ month: first, cutOff, plan, tolerance, windowDays, lockWeek }), saved);
  const reasons = register.filter((r) => r.code.startsWith("anomaly_") && r.status === "agreed" && r.deviation_note).map((r) => r.code.slice("anomaly_".length));
  const test = runrateTest({ plan, tolerance, reasons });
  const controls: ControlV3[] = [c49({ rows: plan.rows, pnlMtd }), ...(drivers?.controls ?? [])];
  const blockers = lockBlockers({ month: first, today, lockWeek, plan, register, test, controls });
  return { first, last, cutOff, today, tolerance, lockWeek, lockDate: v1LockDate(first, lockWeek), windowDays, plan, summary, register, test, controls, blockers, holidays, drivers, budget, events };
}

// ------------------------------------------------------------------------------------------------ mart writes (service role)

export async function ensureOutlook(sb: Supa, first: string): Promise<Row> {
  const { data } = await sb.from("month_outlook").select("*").eq("month", first).maybeSingle();
  if (data) return data as Row;
  const { data: ins, error } = await sb.from("month_outlook").insert({ month: first, status: "open" }).select("*").single();
  if (error) throw new WriteError(`month_outlook: ${error.message}`);
  return ins as Row;
}

const numEq = (a: unknown, b: unknown) => (a === null || a === undefined || a === "" ? null : D(String(a)).toFixed(6)) === (b === null || b === undefined || b === "" ? null : D(String(b)).toFixed(6));

/** Register of the month: new engine rows inserted, a changed value supersedes the agreed row; agreed rows with the same value stay. */
export async function syncRegister(sb: Supa, first: string, register: RegisterRow[]): Promise<void> {
  const mo = await ensureOutlook(sb, first);
  const saved = await fetchAll<Row>((a, b) => sb.from("assumption_register").select("*").eq("month_outlook_id", String(mo.id)).is("deleted_at", null).range(a, b));
  // manual and kalibrasi rows are not the engine's to write or supersede
  const foreign = new Set(saved.filter((x) => String(x.source) !== "engine" && String(x.status) !== "superseded").map((x) => String(x.code)));
  for (const r of register) {
    if (foreign.has(r.code)) continue;
    const cur = saved.find((x) => String(x.code) === r.code && String(x.status) !== "superseded" && s(x.version) === null && String(x.source) === "engine");
    const rec = { month_outlook_id: mo.id, code: r.code, name: r.name, value_num: r.value_num === null ? null : D(r.value_num).toFixed(6), value_text: r.value_text, basis: r.basis, owner: r.owner, source: "engine" };
    if (!cur) { const e = await sb.from("assumption_register").insert({ ...rec, status: "proposed", deviation_note: r.deviation_note }); if (e.error) throw new WriteError(`assumption_register: ${e.error.message}`); continue; }
    if (numEq(cur.value_num, r.value_num) && s(cur.value_text) === r.value_text) continue;
    const u = await sb.from("assumption_register").update({ status: "superseded" }).eq("id", String(cur.id));
    if (u.error) throw new WriteError(`assumption_register: ${u.error.message}`);
    const e = await sb.from("assumption_register").insert({ ...rec, status: "proposed", deviation_note: r.deviation_note });
    if (e.error) throw new WriteError(`assumption_register: ${e.error.message}`);
  }
  // an anomaly day that is no longer an anomaly leaves the register
  const codes = new Set(register.map((r) => r.code));
  for (const x of saved) if (String(x.source) === "engine" && String(x.status) !== "superseded" && !codes.has(String(x.code))) await sb.from("assumption_register").update({ status: "superseded" }).eq("id", String(x.id));
}

export async function writeMonthV4(sb: Supa, st: MonthStateV4): Promise<{ written: number; deleted: number }> {
  let written = 0, deleted = 0;
  const rows = plRowsToMart(st.plan.rows);
  for (let d = st.first; d <= st.last; d = addDays(d, 1)) {
    const r = await martReplace(sb, "pl_daily_v4", d, rows.filter((x) => x.date === d));
    written += r.written; deleted += r.deleted;
  }
  await syncRegister(sb, st.first, st.register);
  // lock pre-flight for the Finance page (the lock action recomputes it)
  const { error } = await sb.from("data_status").upsert({
    table_name: "month_lock", scope: st.first, status: st.blockers.length ? "draft" : "validated", built_at: new Date().toISOString(),
    note: JSON.stringify({ blockers: st.blockers, controls: st.controls.map((c) => ({ code: c.code, status: c.status })), cutOff: st.cutOff, lockDate: st.lockDate, today: st.today }),
  }, { onConflict: "table_name,scope" });
  if (error) throw new WriteError(`data_status: ${error.message}`);
  return { written, deleted };
}

let builtMonths = new Set<string>();
let builderSettings: ModuleSettings = {};

registerBuilder({
  module: "m4_monthly", name: "monthly v4",
  begin: async (sb) => {
    builtMonths = new Set();
    const { data } = await sb.from("app_setting").select("key, value").in("key", ["m5_drivers"]);
    builderSettings = {};
    for (const r of (data ?? []) as Row[]) builderSettings[r.key as "m5_drivers"] = { enabled: (r.value as { enabled?: boolean } | undefined)?.enabled === true };
  },
  build: async (sb, date) => {
    const m = firstOfMonth(date);
    if (builtMonths.has(m)) return `bulan ${m.slice(0, 7)} sudah dibangun (v4)`;
    builtMonths.add(m);
    const st = await computeMonthV4(sb, m, jakartaToday(), builderSettings);
    const w = await writeMonthV4(sb, st);
    return `pl_daily_v4 ${m.slice(0, 7)}: cut-off ${st.cutOff}, ${st.plan.rows.length} baris (${w.written} ditulis, ${w.deleted} dihapus)`;
  },
});

// ------------------------------------------------------------------------------------------------ lock V1 / V2 (P11, P12)

const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));

export const RULE_VERSION = "v4-2026-10";

export interface LockResult { message: string; sha: string; bridge: BridgeV4 | null }

/**
 * Lock V1 or V2 (K9). V1 needs every blocker of lockBlockers resolved (date, controls, cost plan, run-rate test,
 * register); V2 needs V1 and a bridge that closes (C32). The snapshot carries the rows, the register, the days and the
 * rule version, with its SHA-256; the database refuses any later change (version_immutable).
 */
export async function lockVersionV4(sb: Supa, viewer: Viewer, first: string, version: "V1" | "V2", settings: ModuleSettings): Promise<LockResult> {
  const mo = await ensureOutlook(sb, first);
  const { data: have } = await sb.from("month_outlook_version").select("version, snapshot").eq("month_outlook_id", String(mo.id));
  const got = new Map(((have ?? []) as Row[]).map((r) => [String(r.version), r]));
  if (got.has(version)) throw new WriteError(`${version} sudah dikunci`);
  if (version === "V2" && !got.has("V1")) throw new WriteError("Kunci V1 dulu");
  const today = jakartaToday();
  const st = await computeMonthV4(sb, first, today, settings);
  // PRD v4 §7.2: a control blocker (C33, C34, C49) is lifted by an override of the role the policy names
  const { data: ov } = await sb.from("release_override").select("code").eq("scope_kind", "month").eq("scope", `${first}:${version}`).is("deleted_at", null);
  const lifted = new Set(((ov ?? []) as { code: string }[]).map((r) => r.code));
  const blockers = st.blockers.filter((b) => !lifted.has(b.code));
  if (version === "V1" && blockers.length) throw new WriteError(`V1 belum bisa dikunci:\n${blockers.map((b) => `- ${b.code}: ${b.text}`).join("\n")}`);
  const days = versionDaysV4(st.plan.rows, first, st.cutOff);
  let bridge: BridgeV4 | null = null;
  const controls = st.controls.map((c) => ({ code: c.code, status: c.status }));
  if (version === "V2") {
    const v1days = ((got.get("V1")!.snapshot as { days?: VersionDayV4[] } | null)?.days ?? []);
    bridge = bridgeV4(v1days, days);
    const ctl = c32(bridge);
    if (ctl.status !== "LULUS") throw new WriteError(`Bridge V1 → V2 tidak menutup (selisih Rp ${ctl.difference?.toFixed(2)}): ${ctl.action}`);
    controls.push({ code: ctl.code, status: ctl.status }); // release_month checks C32 for V2 from the snapshot
  }
  const t = { actual: totalsV4(st.plan.rows, "actual"), forecast: totalsV4(st.plan.rows, "forecast") };
  const tot = { revenue: t.actual.revenue.plus(t.forecast.revenue), cogs: t.actual.cogs.plus(t.forecast.cogs), gp: t.actual.gp.plus(t.forecast.gp), opex: t.actual.opex.plus(t.forecast.opex), nibt: t.actual.nibt.plus(t.forecast.nibt) };
  const snapshot = {
    month: first, version, rule_version: RULE_VERSION, cut_off: st.cutOff, time_zone: "Asia/Jakarta",
    runrate: { revenue_per_day: f2(st.plan.runrate.revenue), window_days: st.windowDays, window_from: st.plan.runrate.windowFrom, days: st.plan.runrate.days, anomalies: st.plan.runrate.anomalies, off_day_factor: st.plan.runrate.offDayFactor.toFixed(6) },
    margin_ref: st.plan.margin.toFixed(6), po_share: st.summary.poShare?.toFixed(6) ?? null, tolerance: st.tolerance,
    days, rows: plRowsToMart(st.plan.rows), register: st.register, controls, bridge: bridge && {
      revenue: Object.fromEntries(Object.entries(bridge.revenue).map(([k, v]) => [k, f2(v)])), gp: Object.fromEntries(Object.entries(bridge.gp).map(([k, v]) => [k, f2(v)])), nibt: Object.fromEntries(Object.entries(bridge.nibt).map(([k, v]) => [k, f2(v)])),
    },
    totals: Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, f2(v)])),
  };
  const json = canonical(snapshot);
  const sha = createHash("sha256").update(json).digest("hex");
  // PRD v4 §7.2: written only by public.release_month, which checks order, dates, register, C48, STALE and controls again
  const { error } = await sb.rpc("release_month", {
    p_month: first, p_version: version, p_json: json, p_sha: sha, p_cut_off: st.cutOff,
    p_totals: { revenue: f2(tot.revenue), cogs: f2(tot.cogs), gp: f2(tot.gp), opex: f2(tot.opex), nibt: f2(tot.nibt) },
    p_rule_version: RULE_VERSION, p_anomaly_days: st.plan.runrate.anomalies, p_po_share: st.summary.poShare === null ? null : st.summary.poShare.toFixed(6),
  });
  if (error) throw new WriteError(error.message);
  return { message: `${version} dikunci (SHA ${sha.slice(0, 12)}…)`, sha, bridge };
}

export async function agreeAssumption(sb: Supa, viewer: Viewer, id: string, note: string | null): Promise<string> {
  const { data } = await sb.from("assumption_register").select("*").eq("id", id).maybeSingle();
  const r = data as Row | null;
  if (!r) throw new WriteError("Asumsi tidak ditemukan");
  if (String(r.code).startsWith("anomaly_") && !note) throw new WriteError("Hari anomali butuh alasan (catatan deviasi)");
  const { error } = await sb.from("assumption_register").update({ status: "agreed", agreed_at: new Date().toISOString(), deviation_note: note ?? s(r.deviation_note), owner: s(r.owner) ?? viewer.email }).eq("id", id);
  if (error) throw new WriteError(error.message);
  return `${String(r.code)} disepakati`;
}

