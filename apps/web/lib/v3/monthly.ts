import "server-only";
/**
 * M4 monthly outlook (PRD v3 §4.5). Loads the month (journal, PO lines of the computed weeks, unbilled DOs, drivers),
 * runs @kgr/engine (actualDaily, runrateRevenue, forecastDays, opexRemaining, forecastPlRows, bridge, accuracy,
 * calibrate) and writes the data mart pl_daily, versions and accuracy. Pages read pl_daily; no arithmetic here.
 */
import { createHash } from "node:crypto";
import {
  D, accuracy, actualDaily, addDays, bridge, calibrate, dailyTotals, daysInMonth, firstOfMonth, forecastDays, forecastPlRows, gpPctMtd,
  holidaysFromJournal, isCogsLine, isRevenueLine, monthEnd, monthlyControls, opexRemaining, ordersFromWeek, runrateRevenue, sum,
  sumRows, toFixedString, unbilledFromWeek, v1LockDate, versionDays,
  type Bridge, type ControlV3, type Decimal, type ForecastOrder, type PlDailyRow, type RunRate, type VersionDay,
} from "@kgr/engine";
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import { computeForWeek, dataToday, fetchAll, listWeeks } from "../data";
import { must, mustRows } from "../loader";
import { WriteError } from "../write";
import { martReplace, registerBuilder } from "../rebuild-registry";
import type { ModuleSettings } from "../modules-core";
import { loadMonthDrivers, type MonthDrivers } from "./drivers";
import type { Row } from "./uploads";
import { settingValue } from "../request-memo";

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const f2 = (x: Decimal | null) => (x === null ? null : toFixedString(x, 2));
/** RPA week: Monday–Saturday (V28). */
export const isWorkingDay = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0;

export interface MonthState {
  first: string;
  last: string;
  cutOff: string;
  outlook: Row | null;
  actualRows: PlDailyRow[];
  forecastRows: PlDailyRow[];
  holidays: string[];
  runrate: RunRate;
  gpPct: Decimal;
  orders: ForecastOrder[];
  drivers: MonthDrivers | null;
  tolerance: string;
  /** K9: the V1 lock Thursday is the Thursday of week `v1LockWeek` (parameter v1_lock_week, 3). */
  v1LockWeek: number;
  v1LockDate: string;
  /** K3: run-rate window in calendar days (parameter runrate_window_days, 7). */
  windowDays: number;
}

/** Cut-off of a month: the month_outlook override, else yesterday for the running month, else the month end. */
function cutOffOf(first: string, today: string, override: string | null): string {
  if (override) return override;
  const last = monthEnd(first);
  const yday = addDays(today, -1);
  return yday < first ? addDays(first, -1) : yday < last ? yday : last;
}

export async function computeMonth(sb: Supa, monthFirst: string, today: string, settings: ModuleSettings): Promise<MonthState> {
  const first = firstOfMonth(monthFirst), last = monthEnd(first);
  const mo = must(await sb.from("month_outlook").select("*").eq("month", first).maybeSingle(), "monthly.month_outlook") as Row | null;
  const outlook = (mo as Row | null) ?? null;
  const cutOff = cutOffOf(first, today, s(outlook?.cut_off_date));
  // journal from 6 weeks before the cut-off (the run-rate looks back 20 working days, across the month start)
  const from = addDays(cutOff, -42) < first ? addDays(cutOff, -42) : first;
  const [gl, coa] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("gl_line").select("date, account, debit, credit").is("deleted_at", null).gte("date", from).lte("date", cutOff).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("coa_map").select("account, pl_line").is("deleted_at", null).order("account").range(a, b)),
  ]);
  const glRows = gl.map((g) => ({ date: s(g.date), account: s(g.account), debit: s(g.debit), credit: s(g.credit) }));
  const coaRows = coa.map((c) => ({ account: String(c.account), pl_line: s(c.pl_line) }));
  // the weeks overlapping the month: PO lines after the cut-off and unbilled DOs, valued by the weekly engine
  const weeks = (await listWeeks(sb)).filter((w) => w.week_end >= first && w.week_start <= last);
  const orders: ForecastOrder[] = [];
  const unbilled: ReturnType<typeof unbilledFromWeek> = [];
  let tolerance = "0.10", v1LockWeek = 3, windowDays = 7, wT = "0.7", wF = "0.5";
  for (const w of weeks) {
    const c = await computeForWeek(sb, w.week_start);
    if (!c) continue;
    const status = new Map((c.loaded.db.sales as Row[]).map((r) => [String(r.id), s(r.demand_status)]));
    const p = must(await sb.from("parameter").select("*").eq("week_id", w.id).maybeSingle(), "monthly.parameter") as Row | null;
    const pr = (p ?? {}) as Row;
    tolerance = s(pr.forecast_tolerance_pct) ?? tolerance; v1LockWeek = Number(pr.v1_lock_week ?? v1LockWeek); windowDays = Number(pr.runrate_window_days ?? windowDays);
    wT = s(pr.tentative_weight) ?? wT; wF = s(pr.forecast_weight) ?? wF;
    const lo = addDays(cutOff, 1) > w.week_start ? addDays(cutOff, 1) : w.week_start;
    const hi = last < w.week_end ? last : w.week_end;
    if (lo <= hi) orders.push(...ordersFromWeek(c.result.sales, lo, hi, (id) => { const st = id ? status.get(id) : null; return st === "Tentative" ? wT : st === "Forecast" ? wF : "1"; }));
    const ulo = first > w.week_start ? first : w.week_start, uhi = cutOff < w.week_end ? cutOff : w.week_end;
    if (ulo <= uhi) unbilled.push(...unbilledFromWeek(c.result.sales, ulo, uhi));
  }
  const all = actualDaily({ gl: glRows, coa: coaRows, from, to: cutOff, unbilled });
  const actualRows = all.filter((r) => r.date >= first);
  const holidays = holidaysFromJournal(all, from, cutOff, isWorkingDay);
  const daily = dailyTotals(all);
  const runrate = runrateRevenue({ revenueByDay: new Map([...daily].map(([d, t]) => [d, t.revenue])), cutOff, isWorkingDay, holidays, windowDays });
  for (const a of runrate.anomalies) for (const r of actualRows) if (r.date === a.date) r.anomaly = true;
  const gpPct = gpPctMtd(daily, first, cutOff);
  const days = cutOff >= last ? [] : forecastDays({ cutOff, orders, runrate: runrate.revenue, gpPct, isWorkingDay, holidays, offDayFactor: runrate.offDayFactor });
  const drivers = settings.m5_drivers?.enabled ? await loadMonthDrivers(sb, first, addDays(cutOff, 1)) : null;
  // run-rate opex lines from the v1 run-rate table of the last week in the month (monthly amounts)
  const lastWeek = weeks[weeks.length - 1];
  const rrRows = lastWeek ? mustRows(await sb.from("runrate").select("pl_line, monthly_amount").eq("week_id", lastWeek.id), "monthly.runrate") as Row[] : [];
  const variable = drivers ? drivers.coa.filter((c) => c.driver_type === "variable" && c.rp_per_kg !== null && !isCogsLine(String(c.pl_line))).map((c) => ({ pl_line: String(c.pl_line), rp_per_kg: String(c.rp_per_kg) })) : [];
  const opex = days.length ? opexRemaining({
    fixed: drivers?.fixed ?? [], runrate: rrRows.map((r) => ({ pl_line: String(r.pl_line), monthly: String(r.monthly_amount) })),
    variable, forecastKg: sum(orders.map((o) => D(o.kg))), remainingDays: days.length, daysInMonth: daysInMonth(first),
  }) : [];
  const forecastRows = forecastPlRows({ days, orders, opex });
  return {
    first, last, cutOff, outlook, actualRows, forecastRows, holidays, runrate, gpPct, orders, drivers, tolerance, v1LockWeek, windowDays,
    v1LockDate: v1LockDate(first, v1LockWeek),
  };
}

const martRow = (r: PlDailyRow) => ({ date: r.date, pl_line: r.pl_line, basis: r.basis, actual: f2(r.actual), forecast: f2(r.forecast), anomaly: r.anomaly });

/** Write the month into pl_daily (one scope per date; every day of the month, so stale forecast days are cleared). */
export async function writeMonthMart(sb: Supa, st: MonthState): Promise<{ written: number; deleted: number }> {
  let written = 0, deleted = 0;
  const rows = [...st.actualRows, ...st.forecastRows];
  for (let d = st.first; d <= st.last; d = addDays(d, 1)) {
    const r = await martReplace(sb, "pl_daily", d, rows.filter((x) => x.date === d).map(martRow));
    written += r.written; deleted += r.deleted;
  }
  try {
    await writeEngineAssumptions(sb, st);
  } catch (e) {
    // admin / finance only (RLS); other roles keep the mart already written by the rebuild. Any other error stops (K56).
    if (!/row-level security|permission denied/i.test((e as Error).message)) throw e;
  }
  return { written, deleted };
}

/** The engine's assumptions of the month (cut-off, run-rate, GP% 4 weeks, anomaly days) as outlook_assumption source 'engine'. */
async function writeEngineAssumptions(sb: Supa, st: MonthState): Promise<void> {
  const mo = await ensureOutlook(sb, st.first);
  const rows: { code: string; description: string; value_text: string | null; value_num: string | null }[] = [
    { code: "cut_off", description: "Cut-off (aktual s.d.)", value_text: st.cutOff, value_num: null },
    { code: "runrate_revenue", description: `Run-rate revenue per hari kerja (${st.runrate.days.length} hari kerja dalam ${st.windowDays} hari kalender terakhir, tanpa anomali)`, value_text: null, value_num: toFixedString(st.runrate.revenue, 2) },
    { code: "gp_pct_4w", description: "GP% bulan berjalan (margin acuan hari run-rate)", value_text: null, value_num: toFixedString(st.gpPct, 6) },
    { code: "anomaly_days", description: "Hari anomali (tidak ikut run-rate)", value_text: st.runrate.anomalies.map((a) => `${a.date} (${a.reason})`).join(", ") || "—", value_num: null },
    { code: "holidays", description: "Hari kerja tanpa jurnal (libur)", value_text: st.holidays.join(", ") || "—", value_num: null },
    { code: "forecast_tolerance_pct", description: "Toleransi forecast (rentang)", value_text: null, value_num: st.tolerance },
    { code: "v1_lock_date", description: `Kunci V1 (Kamis minggu ke-${st.v1LockWeek})`, value_text: st.v1LockDate, value_num: null },
  ];
  const data = mustRows(await sb.from("outlook_assumption").select("id, code, value_text, value_num").eq("month_outlook_id", String(mo.id)).eq("source", "engine").is("deleted_at", null), "monthly.outlook_assumption");
  const have = new Map((data as Row[]).map((r) => [String(r.code), r]));
  for (const r of rows) {
    const old = have.get(r.code);
    if (old && s(old.value_text) === r.value_text && (old.value_num === null ? null : D(String(old.value_num)).toFixed(6)) === (r.value_num === null ? null : D(r.value_num).toFixed(6))) continue;
    const rec = { month_outlook_id: mo.id, source: "engine", ...r };
    const e = old ? await sb.from("outlook_assumption").update(rec).eq("id", String(old.id)) : await sb.from("outlook_assumption").insert(rec);
    if (e.error) throw new WriteError(e.error.message);
  }
}

let builtMonths = new Set<string>();
let builderSettings: ModuleSettings = {};
/** The cut-off of the months being rebuilt: the date the data stands on (dataToday), as the weekly engine. */
let builderToday = "";

registerBuilder({
  module: "m4_monthly", name: "monthly",
  begin: async (sb) => {
    builtMonths = new Set();
    builderToday = await dataToday(sb);
    const data = ({ value: await settingValue(sb, "m5_drivers") }) as Row | null;
    builderSettings = { m5_drivers: { enabled: ((data as Row | null)?.value as { enabled?: boolean } | undefined)?.enabled === true } };
  },
  build: async (sb, date) => {
    const m = firstOfMonth(date);
    if (builtMonths.has(m)) return `bulan ${m.slice(0, 7)} sudah dibangun`;
    builtMonths.add(m);
    const st = await computeMonth(sb, m, builderToday || await dataToday(sb), builderSettings);
    const w = await writeMonthMart(sb, st);
    return `bulan ${m.slice(0, 7)}: cut-off ${st.cutOff}, ${st.actualRows.length + st.forecastRows.length} baris (${w.written} ditulis, ${w.deleted} dihapus)`;
  },
});

/** Reads for /m/[month]: the mart rows of the month (engine sums them). */
export async function plDaily(sb: Supa, first: string): Promise<PlDailyRow[]> {
  const rows = await fetchAll<Row>((a, b) => sb.from("pl_daily").select("*").gte("date", first).lte("date", monthEnd(first)).order("date").order("basis").order("pl_line").range(a, b));
  return rows.map((r) => ({ date: String(r.date), pl_line: String(r.pl_line), basis: r.basis as PlDailyRow["basis"], actual: r.actual === null ? null : D(String(r.actual)), forecast: r.forecast === null ? null : D(String(r.forecast)), anomaly: r.anomaly === true }));
}

async function ensureOutlook(sb: Supa, first: string): Promise<Row> {
  const data = must(await sb.from("month_outlook").select("*").eq("month", first).maybeSingle(), "monthly.month_outlook2") as Row | null;
  if (data) return data as Row;
  const { data: ins, error } = await sb.from("month_outlook").insert({ month: first, status: "open" }).select("*").single();
  if (error) throw new WriteError(`month_outlook: ${error.message}`);
  return ins as Row;
}

export async function setBudget(sb: Supa, first: string, b: { revenue: string | null; gp: string | null; nibt: string | null; cutOff: string | null }): Promise<string> {
  const mo = await ensureOutlook(sb, first);
  const { error } = await sb.from("month_outlook").update({ budget_revenue: b.revenue, budget_gp: b.gp, budget_nibt: b.nibt, cut_off_date: b.cutOff }).eq("id", String(mo.id));
  if (error) throw new WriteError(error.message);
  return "Budget / cut-off disimpan — bangun ulang bulan ini";
}

const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, (x as Record<string, unknown>)[k]])) : x));

/** Lock V1 / V2 (outlook of today's mart) or FINAL (full-month journal + posted adjustments). Immutable, with SHA-256. */
export async function lockVersion(sb: Supa, viewer: Viewer, first: string, version: "V1" | "V2" | "FINAL", today: string, settings: ModuleSettings): Promise<string> {
  const mo = await ensureOutlook(sb, first);
  const have = mustRows(await sb.from("month_outlook_version").select("version").eq("month_outlook_id", String(mo.id)), "monthly.versions2") as Row[];
  const got = new Set(((have ?? []) as Row[]).map((r) => String(r.version)));
  if (got.has(version)) throw new WriteError(`${version} sudah dikunci`);
  const st = await computeMonth(sb, first, version === "FINAL" ? addDays(monthEnd(first), 1) : today, settings);
  if (version === "V1" && today < st.v1LockDate) throw new WriteError(`V1 dikunci mulai Kamis minggu ke-${st.v1LockWeek} (${st.v1LockDate})`);
  if (version === "V2" && !got.has("V1")) throw new WriteError("Kunci V1 dulu");
  if (version === "FINAL" && today <= monthEnd(first)) throw new WriteError("FINAL dikunci setelah akhir bulan");
  const adj = version === "FINAL" ? mustRows(await sb.from("closing_adjustment").select("*").eq("month_outlook_id", String(mo.id)).eq("posted", true).is("deleted_at", null), "monthly.closing_adjustment") as Row[] : [];
  const rows = version === "FINAL" ? st.actualRows : [...st.actualRows, ...st.forecastRows];
  const adjRows: PlDailyRow[] = adj.map((a) => ({ date: monthEnd(first), pl_line: String(a.pl_line), basis: "journal", actual: D(String(a.amount)), forecast: null, anomaly: false }));
  const tot = sumRows([...rows, ...adjRows]);
  const t = { revenue: tot.actual.revenue.plus(tot.forecast.revenue), cogs: tot.actual.cogs.plus(tot.forecast.cogs), gp: tot.actual.gp.plus(tot.forecast.gp), opex: tot.actual.opex.plus(tot.forecast.opex), nibt: tot.actual.nibt.plus(tot.forecast.nibt) };
  const kgByDay: Record<string, string> = {};
  for (const o of st.orders) kgByDay[o.delivery_date] = D(kgByDay[o.delivery_date] ?? "0").plus(D(o.kg)).toFixed(2); // missing-ok: akumulator kg per tanggal, mulai dari 0 untuk dijumlah
  const snapshot = {
    month: first, version, cut_off: st.cutOff, runrate: f2(st.runrate.revenue), gp_pct: toFixedString(st.gpPct, 6), anomalies: st.runrate.anomalies, holidays: st.holidays,
    days: versionDays(rows, first, kgByDay), rows: rows.map(martRow), adjustments: adj.map((a) => ({ code: a.code, pl_line: a.pl_line, amount: a.amount })),
    totals: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, f2(v)])),
  };
  const json = canonical(snapshot);
  const sha = createHash("sha256").update(json).digest("hex");
  // PRD v4 §7.2: written only by public.release_month (version order, FINAL after month end, C48, controls)
  const { error } = await sb.rpc("release_month", {
    p_month: first, p_version: version, p_json: json, p_sha: sha, p_cut_off: st.cutOff,
    p_totals: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, f2(v)])), p_rule_version: null, p_anomaly_days: null, p_po_share: null,
  });
  if (error) throw new WriteError(`month_outlook_version: ${error.message}`);
  void viewer;
  if (version === "FINAL") await afterFinal(sb, mo, first, t, st);
  return `${version} dikunci (SHA ${sha.slice(0, 12)}…)`;
}

/** After FINAL: accuracy of V1 / V2 (before and after the closing adjustments) and calibration for the next month. */
async function afterFinal(sb: Supa, mo: Row, first: string, final: { revenue: Decimal; gp: Decimal; nibt: Decimal }, st: MonthState): Promise<void> {
  const versions = mustRows(await sb.from("month_outlook_version").select("version, revenue, gp, nibt").eq("month_outlook_id", String(mo.id)).neq("version", "FINAL"), "monthly.versions") as Row[];
  const adj = mustRows(await sb.from("closing_adjustment").select("pl_line, amount").eq("month_outlook_id", String(mo.id)).eq("posted", true).is("deleted_at", null), "monthly.adj_final") as Row[];
  const sumAdj = (p: (l: string) => boolean) => sum(adj.filter((a) => p(String(a.pl_line))).map((a) => D(String(a.amount))));
  const a = accuracy({
    final: { revenue: final.revenue, gp: final.gp, nibt: final.nibt },
    adjustments: { revenue: sumAdj(isRevenueLine), gp: sumAdj((l) => isRevenueLine(l) || isCogsLine(l)), nibt: sumAdj(() => true) },
    // a version locked without every figure (revenue, GP, NIBT) cannot be scored against FINAL: it is left out, not scored as 0
    versions: versions.filter((v) => v.revenue !== null && v.gp !== null && v.nibt !== null).map((v) => ({ version: String(v.version), revenue: String(v.revenue), gp: String(v.gp), nibt: String(v.nibt) })),
  });
  const rows = a.rows.flatMap((r) => [
    { metric: "bias", value: r.bias }, { metric: "abs_err", value: r.abs_err }, { metric: "MAPE", value: r.ape }, { metric: "bias_pre", value: r.bias_pre }, { metric: "MAPE_pre", value: r.ape_pre },
  ].map((m) => ({ month_outlook_id: mo.id, version: r.version, scope: r.scope, metric: m.metric, value: toFixedString(m.value, 6) })));
  if (rows.length) { const e = await sb.from("outlook_accuracy").upsert(rows, { onConflict: "month_outlook_id,version,metric,scope" }); if (e.error) throw new WriteError(`outlook_accuracy: ${e.error.message}`); }
  const daily = dailyTotals(st.actualRows);
  const props = calibrate({ revenueByDay: new Map([...daily].map(([d, t]) => [d, t.revenue])), daily, month: first, isWorkingDay, holidays: st.holidays });
  const next = await ensureOutlook(sb, addDays(monthEnd(first), 1));
  const e2 = await sb.from("outlook_assumption").insert(props.map((p) => ({ month_outlook_id: next.id, code: p.code, description: p.description, value_num: toFixedString(p.value, 6), source: "kalibrasi" })));
  if (e2.error) throw new WriteError(`outlook_assumption: ${e2.error.message}`);
}

export interface MonthView {
  versions: Row[];
  adjustments: Row[];
  accuracy: Row[];
  assumptions: Row[];
  bridge: Bridge | null;
  controls: ControlV3[];
}

export async function monthView(sb: Supa, first: string): Promise<MonthView> {
  const mo = must(await sb.from("month_outlook").select("id").eq("month", first).maybeSingle(), "monthly.month_outlook_id") as Row | null;
  if (!mo) return { versions: [], adjustments: [], accuracy: [], assumptions: [], bridge: null, controls: monthlyControls({ bridge: null }) };
  const id = String((mo as Row).id);
  const [versions, adjustments, acc, assumptions] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("month_outlook_version").select("*").eq("month_outlook_id", id).order("locked_at").order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("closing_adjustment").select("*").eq("month_outlook_id", id).is("deleted_at", null).order("code").order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("outlook_accuracy").select("*").eq("month_outlook_id", id).order("metric").order("month_outlook_id").order("scope").order("version").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("outlook_assumption").select("*").eq("month_outlook_id", id).is("deleted_at", null).order("id").range(a, b)),
  ]);
  const v1 = versions.find((v) => v.version === "V1"), v2 = versions.find((v) => v.version === "V2");
  const days = (v: Row | undefined) => ((v?.snapshot as { days?: VersionDay[] } | undefined)?.days ?? []);
  const rr = (v: Row | undefined) => (v?.snapshot as { runrate?: string } | undefined)?.runrate ?? null;
  const b = v1 && v2 ? bridge(days(v1), days(v2), { runrateChanged: rr(v1) !== rr(v2) }) : null;
  return { versions, adjustments, accuracy: acc, assumptions, bridge: b, controls: monthlyControls({ bridge: b }) };
}
