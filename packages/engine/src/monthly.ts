/**
 * M4 — monthly outlook (PRD v3 §4.5). Pure functions, decimal.js.
 *
 * Actual per day = journal (P&L accounts via coa_map.pl_line; revenue positive, costs negative as in v1 O_PnL) plus
 * delivered-not-invoiced DOs (basis do_unbilled, K11). Forecast per day after the cut-off: days with PO lines = their
 * weighted revenue and cost; working days without PO = run-rate (K3, PRD v4: mean revenue of the working days in the
 * last `runrate_window_days` (7) calendar days before the cut-off, without anomaly days: 0 on a working day, or above
 * mean + 3σ) at the GP% of the month to date (K5, P6); Sundays and holidays at the factor the actuals show (August: 0).
 * Outlook = actual MTD + forecast; range = ± tolerance on the forecast part only.
 * The v3 rule (mean of the 20 last working days) is revoked (PRD v4 §0.2).
 */
import { D, Decimal, ZERO, div, sum, type Num } from "./decimal";
import { addDays, daysInMonth, diffDays, firstOfMonth, type ISODate } from "./dates";
import type { ControlV3 } from "./controls-v3";

export type PlBasis = "journal" | "do_unbilled" | "po" | "runrate" | "fixed" | "variable";

export interface PlDailyRow {
  date: ISODate;
  pl_line: string;
  actual: Decimal | null;
  forecast: Decimal | null;
  basis: PlBasis;
  anomaly: boolean;
}

export const isRevenueLine = (l: string) => l.startsWith("Revenue");
/** v5 K22 / Q63: the costing revaluation of sold kg and the idle capacity are cost of sales, not opex. */
export const V5_COGS_LINES = ["Selisih costing", "Biaya kapasitas idle"] as const;
/**
 * R66 (K63) how the two v5 costing rows count (app_setting v5_pl, field costing_rows_mode): 'cogs' (default, the behaviour of
 * v5) = cost of sales; 'memo' = neither COGS nor opex, so the "Actual · jurnal" columns hold journal lines only (= the FS)
 * and the rows appear as a memo block below the journal NIBT.
 */
export type CostingRowsMode = "cogs" | "memo";
export const isMemoLine = (l: string, mode: CostingRowsMode = "cogs") => mode === "memo" && (V5_COGS_LINES as readonly string[]).includes(l);
export const isCogsLine = (l: string, mode: CostingRowsMode = "cogs") => l.startsWith("COGS") || l.startsWith("Other COGS") || (mode === "cogs" && (V5_COGS_LINES as readonly string[]).includes(l));
/** Operating cost: every line that is not revenue, COGS or a memo row (a memo row is in no journal total, not in the NIBT either). */
export const isOpexLine = (l: string, mode: CostingRowsMode = "cogs") => !isRevenueLine(l) && !isCogsLine(l, mode) && !isMemoLine(l, mode);

export const monthEnd = (d: ISODate): ISODate => addDays(firstOfMonth(d), daysInMonth(d) - 1);

/** Journal lines → P&L per day × line (v1 sign: −(debit − credit)); optional unbilled DOs as their own basis. */
export function actualDaily(x: {
  gl: { date: ISODate | null; account: string | null; debit: Num | null; credit: Num | null }[];
  coa: { account: string; pl_line: string | null }[];
  from: ISODate;
  to: ISODate;
  unbilled?: { date: ISODate; revenue_line: string; revenue: Num; cogs_line: string; cogs: Num }[];
}): PlDailyRow[] {
  const lineOf = new Map(x.coa.filter((c) => c.pl_line).map((c) => [c.account, c.pl_line as string]));
  const m = new Map<string, PlDailyRow>();
  const add = (date: ISODate, line: string, v: Decimal, basis: PlBasis) => {
    const k = `${date}|${line}|${basis}`;
    const r = m.get(k) ?? { date, pl_line: line, actual: ZERO, forecast: null, basis, anomaly: false };
    r.actual = r.actual!.plus(v);
    m.set(k, r);
  };
  for (const g of x.gl) {
    if (!g.date || g.date < x.from || g.date > x.to || !g.account) continue;
    const l = lineOf.get(g.account);
    if (l) add(g.date, l, D(g.credit ?? 0).minus(D(g.debit ?? 0)), "journal");
  }
  for (const u of x.unbilled ?? []) {
    if (u.date < x.from || u.date > x.to) continue;
    add(u.date, u.revenue_line, D(u.revenue), "do_unbilled");
    add(u.date, u.cogs_line, D(u.cogs).neg(), "do_unbilled");
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.pl_line.localeCompare(b.pl_line) || a.basis.localeCompare(b.basis));
}

/** Revenue and COGS per day (actual) from P&L rows. */
export function dailyTotals(rows: PlDailyRow[], value: "actual" | "forecast" = "actual"): Map<ISODate, { revenue: Decimal; cogs: Decimal }> {
  const out = new Map<ISODate, { revenue: Decimal; cogs: Decimal }>();
  for (const r of rows) {
    const v = r[value];
    if (v === null) continue;
    const t = out.get(r.date) ?? { revenue: ZERO, cogs: ZERO };
    if (isRevenueLine(r.pl_line)) t.revenue = t.revenue.plus(v);
    else if (isCogsLine(r.pl_line)) t.cogs = t.cogs.plus(v);
    out.set(r.date, t);
  }
  return out;
}

export interface RunRate {
  revenue: Decimal;
  /** Working days used (newest last). */
  days: ISODate[];
  anomalies: { date: ISODate; reason: "nol" | "> 3σ" }[];
  /** First day of the calendar window and its length (K3: runrate_window_days, 7). */
  windowFrom: ISODate;
  windowDays: number;
  /**
   * Revenue on Sundays and holidays in the window as a share of the run-rate (K3 "faktor Minggu/libur dari pola
   * actual"; August 2026: 0 because 23 Aug has no revenue). Applied to non-working days without PO.
   */
  offDayFactor: Decimal;
}

/**
 * Run-rate revenue per working day (PRD v4 K3, §3.2 P3): mean over the working days of the last `windowDays` calendar
 * days up to the cut-off, without anomaly days (revenue 0 on a working day, or above mean + 3σ of the non-zero working
 * days of the window). Holidays (no journal at all, listed in `holidays`) are not working days. 31 Aug 2026 =
 * (301,4 + 579,3 + 82,3 + 226,7 + 362,3) / 5 = 310,4 jt (25 Aug, revenue 0, is thrown out).
 */
export function runrateRevenue(x: { revenueByDay: Map<ISODate, Decimal>; cutOff: ISODate; isWorkingDay: (d: ISODate) => boolean; holidays?: ISODate[]; windowDays?: number; sigma?: number }): RunRate {
  const windowDays = x.windowDays ?? 7, k = x.sigma ?? 3;
  const windowFrom = addDays(x.cutOff, -(windowDays - 1));
  const days: ISODate[] = [], off: ISODate[] = [];
  for (let d = windowFrom; d <= x.cutOff; d = addDays(d, 1)) (x.isWorkingDay(d) && !(x.holidays ?? []).includes(d) ? days : off).push(d);
  const val = (d: ISODate) => x.revenueByDay.get(d) ?? ZERO;
  const nonZero = days.filter((d) => !val(d).isZero()).map(val);
  const mean = nonZero.length ? sum(nonZero).div(nonZero.length) : ZERO;
  const sd = nonZero.length ? sum(nonZero.map((v) => v.minus(mean).pow(2))).div(nonZero.length).sqrt() : ZERO;
  const cap = mean.plus(sd.times(k));
  const anomalies: RunRate["anomalies"] = [];
  const ok: ISODate[] = [];
  for (const d of days) {
    if (val(d).isZero()) anomalies.push({ date: d, reason: "nol" });
    else if (val(d).gt(cap)) anomalies.push({ date: d, reason: "> 3σ" });
    else ok.push(d);
  }
  const revenue = ok.length ? sum(ok.map(val)).div(ok.length) : ZERO;
  const offDayFactor = revenue.isZero() || !off.length ? ZERO : sum(off.map(val)).div(off.length).div(revenue);
  return { revenue, days: ok, anomalies, windowFrom, windowDays, offDayFactor };
}

/** GP% of the month to date (K5, P6: the reference margin of run-rate days until M1 gives a margin per SKU). */
export function gpPctMtd(daily: Map<ISODate, { revenue: Decimal; cogs: Decimal }>, month: ISODate, cutOff: ISODate): Decimal {
  let rev = ZERO, cogs = ZERO;
  for (const [d, t] of daily) if (d >= firstOfMonth(month) && d <= cutOff) { rev = rev.plus(t.revenue); cogs = cogs.plus(t.cogs); }
  return div(rev.plus(cogs), rev);
}

/**
 * V1 lock day (K9): the Thursday of week `lockWeek` of the month, counted as the n-th Thursday (Thursday = the weekly
 * release day). August 2026, lockWeek 3 → 20 Aug 2026 (Thursdays: 6, 13, 20, 27).
 */
export function v1LockDate(month: ISODate, lockWeek: number): ISODate {
  const first = firstOfMonth(month);
  const dow = new Date(`${first}T00:00:00Z`).getUTCDay();
  const firstThu = addDays(first, (4 - dow + 7) % 7);
  return addDays(firstThu, 7 * (Math.max(1, lockWeek) - 1));
}

/** GP% of the last `days` calendar days up to the cut-off (actual). */
export function gpPctWindow(daily: Map<ISODate, { revenue: Decimal; cogs: Decimal }>, cutOff: ISODate, days = 28): Decimal {
  let rev = ZERO, cogs = ZERO;
  for (const [d, t] of daily) if (diffDays(cutOff, d) >= 0 && diffDays(cutOff, d) < days) { rev = rev.plus(t.revenue); cogs = cogs.plus(t.cogs); }
  return div(rev.plus(cogs), rev);
}

export interface ForecastDay {
  date: ISODate;
  basis: "po" | "runrate" | "none";
  revenue: Decimal;
  /** Negative (v1 sign). */
  cogs: Decimal;
  gp: Decimal;
  kg: Decimal | null;
}

/** Forecast per day after the cut-off to the month end. Orders arrive valued (weighted revenue, cost at MA / plan). */
export function forecastDays(x: {
  cutOff: ISODate;
  orders: { delivery_date: ISODate; kg: Num; revenue: Num; cost: Num }[];
  runrate: Decimal;
  gpPct: Decimal;
  isWorkingDay: (d: ISODate) => boolean;
  holidays?: ISODate[];
  /** Share of the run-rate booked on Sundays / holidays without PO (K3); default 0. */
  offDayFactor?: Num;
}): ForecastDay[] {
  const end = monthEnd(x.cutOff);
  const out: ForecastDay[] = [];
  for (let d = addDays(x.cutOff, 1); d <= end; d = addDays(d, 1)) {
    const os = x.orders.filter((o) => o.delivery_date === d);
    if (os.length) {
      const revenue = sum(os.map((o) => D(o.revenue))), cost = sum(os.map((o) => D(o.cost)));
      out.push({ date: d, basis: "po", revenue, cogs: cost.neg(), gp: revenue.minus(cost), kg: sum(os.map((o) => D(o.kg))) });
    } else if (x.isWorkingDay(d) && !(x.holidays ?? []).includes(d)) {
      const gp = x.runrate.times(x.gpPct);
      out.push({ date: d, basis: "runrate", revenue: x.runrate, cogs: gp.minus(x.runrate), gp, kg: null });
    } else if (D(x.offDayFactor ?? 0).gt(0)) {
      const rev = x.runrate.times(D(x.offDayFactor!)), gp = rev.times(x.gpPct);
      out.push({ date: d, basis: "runrate", revenue: rev, cogs: gp.minus(rev), gp, kg: null });
    } else out.push({ date: d, basis: "none", revenue: ZERO, cogs: ZERO, gp: ZERO, kg: null });
  }
  return out;
}

export interface OutlookTotals {
  revenue: Decimal;
  cogs: Decimal;
  gp: Decimal;
  opex: Decimal;
  nibt: Decimal;
}

export interface MonthOutlook {
  actual: OutlookTotals;
  forecast: OutlookTotals;
  outlook: OutlookTotals;
  /** Share of the forecast revenue that comes from PO lines. */
  sharePo: Decimal;
  range: { revenueLow: Decimal; revenueHigh: Decimal; gpLow: Decimal; gpHigh: Decimal };
  budget: { revenue: Decimal | null; gp: Decimal | null; needPerDay: Decimal | null; remainingDays: number };
}

/**
 * Outlook = actual MTD + forecast. Opex: actual MTD of the cost lines + the remaining amount the drivers give
 * (fixed: schedule − journal; run-rate / variable: as passed). Range ± tolerance on the forecast part only.
 */
export function monthOutlook(x: {
  actualRows: PlDailyRow[];
  forecast: ForecastDay[];
  /** Remaining opex of the month from the drivers (negative = cost), already excluding the actual MTD. */
  opexRemaining?: Num;
  budget?: { revenue: Num | null; gp: Num | null } | null;
  tolerance: Num;
}): MonthOutlook {
  const t = (f: (r: PlDailyRow) => boolean) => sum(x.actualRows.filter(f).map((r) => r.actual ?? ZERO));
  const aRev = t((r) => isRevenueLine(r.pl_line)), aCogs = t((r) => isCogsLine(r.pl_line));
  const aOpex = t((r) => !isRevenueLine(r.pl_line) && !isCogsLine(r.pl_line));
  const actual: OutlookTotals = { revenue: aRev, cogs: aCogs, gp: aRev.plus(aCogs), opex: aOpex, nibt: aRev.plus(aCogs).plus(aOpex) };
  const fRev = sum(x.forecast.map((f) => f.revenue)), fCogs = sum(x.forecast.map((f) => f.cogs)), fOpex = D(x.opexRemaining ?? 0);
  const forecast: OutlookTotals = { revenue: fRev, cogs: fCogs, gp: fRev.plus(fCogs), opex: fOpex, nibt: fRev.plus(fCogs).plus(fOpex) };
  const add = (a: OutlookTotals, b: OutlookTotals): OutlookTotals => ({ revenue: a.revenue.plus(b.revenue), cogs: a.cogs.plus(b.cogs), gp: a.gp.plus(b.gp), opex: a.opex.plus(b.opex), nibt: a.nibt.plus(b.nibt) });
  const outlook = add(actual, forecast);
  const tol = D(x.tolerance);
  const remainingDays = x.forecast.length;
  const bRev = x.budget?.revenue === null || x.budget?.revenue === undefined ? null : D(x.budget.revenue);
  const bGp = x.budget?.gp === null || x.budget?.gp === undefined ? null : D(x.budget.gp);
  return {
    actual, forecast, outlook,
    sharePo: div(sum(x.forecast.filter((f) => f.basis === "po").map((f) => f.revenue)), fRev),
    range: {
      revenueLow: outlook.revenue.minus(fRev.abs().times(tol)), revenueHigh: outlook.revenue.plus(fRev.abs().times(tol)),
      gpLow: outlook.gp.minus(forecast.gp.abs().times(tol)), gpHigh: outlook.gp.plus(forecast.gp.abs().times(tol)),
    },
    budget: { revenue: bRev, gp: bGp, needPerDay: bRev === null || remainingDays === 0 ? null : bRev.minus(aRev).div(remainingDays), remainingDays },
  };
}

/** n-th working day of the month (V1 lock, PRD v3 Q12: 20). */
export function nthWorkingDay(month: ISODate, n: number, isWorkingDay: (d: ISODate) => boolean, holidays: ISODate[] = []): ISODate {
  let d = firstOfMonth(month), k = 0;
  const end = monthEnd(month);
  for (; d <= end; d = addDays(d, 1)) if (isWorkingDay(d) && !holidays.includes(d) && ++k === n) return d;
  return end;
}

// ------------------------------------------------------------------------------------------------ versions, bridge, accuracy

export interface VersionDay {
  date: ISODate;
  kind: "actual" | "po" | "runrate" | "none";
  revenue: Num;
  kg?: Num | null;
}

export interface Bridge {
  from: Decimal;
  to: Decimal;
  dActual: Decimal;
  dVolume: Decimal;
  dPrice: Decimal;
  dEvent: Decimal;
  check: Decimal;
}

/**
 * V1 → V2 revenue bridge: days that were forecast in V1 and are actual in V2 → ΔActual; PO days in both → ΔVolume
 * ((kg2 − kg1) × price1) and ΔPrice ((price2 − price1) × kg2); run-rate days → ΔVolume, or ΔEvent when the run-rate
 * assumption changed between the versions. check = (V2 − V1) − Σ components (must be 0, C32).
 */
export function bridge(v1: VersionDay[], v2: VersionDay[], opts: { runrateChanged?: boolean } = {}): Bridge {
  const a = new Map(v1.map((d) => [d.date, d]));
  const b = new Map(v2.map((d) => [d.date, d]));
  const from = sum(v1.map((d) => D(d.revenue))), to = sum(v2.map((d) => D(d.revenue)));
  let dActual = ZERO, dVolume = ZERO, dPrice = ZERO, dEvent = ZERO;
  for (const date of [...new Set([...a.keys(), ...b.keys()])]) {
    const x = a.get(date), y = b.get(date);
    const r1 = D(x?.revenue ?? 0), r2 = D(y?.revenue ?? 0);
    if (r1.eq(r2)) continue;
    if ((x?.kind ?? "none") !== "actual" && y?.kind === "actual") { dActual = dActual.plus(r2.minus(r1)); continue; }
    if (x?.kind === "po" && y?.kind === "po" && x.kg && y.kg && !D(x.kg).isZero()) {
      // volume at the V1 price; the rest of the change is price × V2 kg
      const vol = D(y.kg).minus(D(x.kg)).times(r1.div(D(x.kg)));
      dVolume = dVolume.plus(vol);
      dPrice = dPrice.plus(r2.minus(r1).minus(vol));
      continue;
    }
    if (x?.kind === "runrate" && y?.kind === "runrate" && opts.runrateChanged) { dEvent = dEvent.plus(r2.minus(r1)); continue; }
    dVolume = dVolume.plus(r2.minus(r1));
  }
  return { from, to, dActual, dVolume, dPrice, dEvent, check: to.minus(from).minus(dActual).minus(dVolume).minus(dPrice).minus(dEvent) };
}

export interface AccuracyRow {
  version: string;
  scope: "revenue" | "gp" | "nibt";
  /** Version value − FINAL. */
  bias: Decimal;
  abs_err: Decimal;
  ape: Decimal;
  /** Against FINAL before the closing adjustments. */
  bias_pre: Decimal;
  ape_pre: Decimal;
}

/** Accuracy of each version vs FINAL, after and before the closing adjustments (PRD v3 §4.5: two numbers). */
export function accuracy(x: { final: Record<"revenue" | "gp" | "nibt", Num>; adjustments: Record<"revenue" | "gp" | "nibt", Num>; versions: { version: string; revenue: Num; gp: Num; nibt: Num }[] }): { rows: AccuracyRow[]; mape: Record<"revenue" | "gp" | "nibt", Decimal>; mapePre: Record<"revenue" | "gp" | "nibt", Decimal> } {
  const scopes = ["revenue", "gp", "nibt"] as const;
  const rows: AccuracyRow[] = [];
  for (const v of x.versions) for (const s of scopes) {
    const fin = D(x.final[s]), pre = fin.minus(D(x.adjustments[s] ?? 0)), val = D(v[s]);
    rows.push({ version: v.version, scope: s, bias: val.minus(fin), abs_err: val.minus(fin).abs(), ape: div(val.minus(fin).abs(), fin.abs()), bias_pre: val.minus(pre), ape_pre: div(val.minus(pre).abs(), pre.abs()) });
  }
  const mean = (s: (typeof scopes)[number], k: "ape" | "ape_pre") => {
    const r = rows.filter((q) => q.scope === s);
    return r.length ? sum(r.map((q) => q[k])).div(r.length) : ZERO;
  };
  return {
    rows,
    mape: { revenue: mean("revenue", "ape"), gp: mean("gp", "ape"), nibt: mean("nibt", "ape") },
    mapePre: { revenue: mean("revenue", "ape_pre"), gp: mean("gp", "ape_pre"), nibt: mean("nibt", "ape_pre") },
  };
}

/** After FINAL: run-rate and GP% of the closed month as proposals for the next month (outlook_assumption, source kalibrasi). */
export function calibrate(x: { revenueByDay: Map<ISODate, Decimal>; daily: Map<ISODate, { revenue: Decimal; cogs: Decimal }>; month: ISODate; isWorkingDay: (d: ISODate) => boolean; holidays?: ISODate[] }): { code: string; value: Decimal; description: string }[] {
  const end = monthEnd(x.month);
  const rr = runrateRevenue({ revenueByDay: x.revenueByDay, cutOff: end, isWorkingDay: x.isWorkingDay, holidays: x.holidays });
  return [
    { code: "runrate_revenue", value: rr.revenue, description: `Run-rate revenue per hari kerja, ${rr.windowDays} hari kalender terakhir bulan ${x.month.slice(0, 7)} (${rr.days.length} hari kerja, ${rr.anomalies.length} anomali)` },
    { code: "gp_pct", value: gpPctMtd(x.daily, x.month, end), description: `GP% bulan ${x.month.slice(0, 7)}` },
  ];
}

/** C32: the V1 → V2 bridge closes to Rp 0 (± Rp 1). */
export function monthlyControls(x: { bridge: Bridge | null }): ControlV3[] {
  const c = x.bridge?.check ?? null;
  return [{
    code: "C32", module: "M4", name: "Bridge V1 → V2 menutup ke Rp 0",
    value: c ?? ZERO, comparator: ZERO, difference: c, status: c === null ? "BELUM DIISI" : c.abs().gt(1) ? "GAGAL" : "LULUS",
    action: c !== null && c.abs().gt(1) ? "Periksa versi V1 / V2 (hari yang hilang dari salah satu versi)" : "", detail: c === null ? ["V1 dan V2 belum dikunci"] : [],
  }];
}

/** Totals helper used by pages (the data mart rows summed by the engine, never by the page). */
export function sumRows(rows: PlDailyRow[]): { actual: OutlookTotals; forecast: OutlookTotals } {
  const tot = (v: "actual" | "forecast"): OutlookTotals => {
    const f = (p: (l: string) => boolean) => sum(rows.filter((r) => p(r.pl_line)).map((r) => r[v] ?? ZERO));
    const revenue = f(isRevenueLine), cogs = f(isCogsLine), opex = f((l) => !isRevenueLine(l) && !isCogsLine(l));
    return { revenue, cogs, gp: revenue.plus(cogs), opex, nibt: revenue.plus(cogs).plus(opex) };
  };
  return { actual: tot("actual"), forecast: tot("forecast") };
}

/** Working days ≤ the cut-off without a single journal line: public holidays (not anomalies). */
export function holidaysFromJournal(rows: { date: ISODate }[], from: ISODate, cutOff: ISODate, isWorkingDay: (d: ISODate) => boolean): ISODate[] {
  const seen = new Set(rows.map((r) => r.date));
  const out: ISODate[] = [];
  for (let d = from; d <= cutOff; d = addDays(d, 1)) if (isWorkingDay(d) && !seen.has(d)) out.push(d);
  return out;
}

export interface ForecastOrder {
  delivery_date: ISODate;
  kg: Num;
  /** Weighted revenue (kg × price × status weight). */
  revenue: Num;
  /** Weighted cost (kg × cost per kg × status weight), positive. */
  cost: Num;
  revenue_line: string;
  cogs_line: string;
}

/** Remaining opex of the month per line from the drivers (negative = cost), spread evenly over the forecast days. */
export function opexRemaining(x: {
  fixed: { pl_line: string; scheduled: Decimal; actual_mtd: Decimal; missing: string[] }[];
  runrate: { pl_line: string; monthly: Num }[];
  variable: { pl_line: string; rp_per_kg: Num }[];
  forecastKg: Num;
  remainingDays: number;
  daysInMonth: number;
}): { pl_line: string; basis: "fixed" | "runrate" | "variable"; amount: Decimal }[] {
  const out: { pl_line: string; basis: "fixed" | "runrate" | "variable"; amount: Decimal }[] = [];
  const fixedLines = new Set(x.fixed.filter((f) => f.missing.length === 0 || !f.scheduled.isZero()).map((f) => f.pl_line));
  for (const f of x.fixed) if (fixedLines.has(f.pl_line)) {
    const rest = f.scheduled.minus(f.actual_mtd);
    if (rest.gt(0)) out.push({ pl_line: f.pl_line, basis: "fixed", amount: rest.neg() });
  }
  const varLines = new Set<string>();
  for (const v of x.variable) {
    if (fixedLines.has(v.pl_line)) continue;
    varLines.add(v.pl_line);
    const a = D(v.rp_per_kg).times(D(x.forecastKg));
    if (!a.isZero()) out.push({ pl_line: v.pl_line, basis: "variable", amount: a.neg() });
  }
  for (const r of x.runrate) {
    if (fixedLines.has(r.pl_line) || varLines.has(r.pl_line)) continue;
    const a = D(r.monthly).times(x.remainingDays).div(x.daysInMonth);
    if (!a.isZero()) out.push({ pl_line: r.pl_line, basis: "runrate", amount: r.pl_line === "Other Income" ? a : a.neg() });
  }
  return out;
}

/** P&L rows of the forecast days (data mart pl_daily): PO revenue / COGS per line, run-rate revenue / COGS, opex per day. */
export function forecastPlRows(x: { days: ForecastDay[]; orders: ForecastOrder[]; opex: { pl_line: string; basis: "fixed" | "runrate" | "variable"; amount: Decimal }[] }): PlDailyRow[] {
  const rows = new Map<string, PlDailyRow>();
  const add = (date: ISODate, pl_line: string, basis: PlBasis, v: Decimal) => {
    const k = `${date}|${pl_line}|${basis}`;
    const r = rows.get(k) ?? { date, pl_line, actual: null, forecast: ZERO, basis, anomaly: false };
    r.forecast = r.forecast!.plus(v);
    rows.set(k, r);
  };
  const n = x.days.length;
  for (const d of x.days) {
    if (d.basis === "po") {
      for (const o of x.orders.filter((q) => q.delivery_date === d.date)) {
        add(d.date, o.revenue_line, "po", D(o.revenue));
        add(d.date, o.cogs_line, "po", D(o.cost).neg());
      }
    } else if (d.basis === "runrate") {
      add(d.date, "Revenue - run-rate", "runrate", d.revenue);
      add(d.date, "COGS - run-rate", "runrate", d.cogs);
    }
    for (const o of x.opex) add(d.date, o.pl_line, o.basis, o.amount.div(n));
  }
  return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date) || a.pl_line.localeCompare(b.pl_line));
}

/** Share of the forecast revenue on PO days, from mart rows. */
export function sharePoRows(rows: PlDailyRow[]): Decimal {
  const rev = rows.filter((r) => r.forecast !== null && isRevenueLine(r.pl_line));
  return div(sum(rev.filter((r) => r.basis === "po").map((r) => r.forecast!)), sum(rev.map((r) => r.forecast!)));
}

/** Per day revenue (actual + forecast) and kind, for the chart and the version snapshot (bridge input). */
export function versionDays(rows: PlDailyRow[], month: ISODate, kgByDay: Record<ISODate, Num> = {}): VersionDay[] {
  const end = monthEnd(month);
  const out: VersionDay[] = [];
  for (let d = firstOfMonth(month); d <= end; d = addDays(d, 1)) {
    const rs = rows.filter((r) => r.date === d && isRevenueLine(r.pl_line));
    const act = rs.filter((r) => r.actual !== null);
    const fc = rs.filter((r) => r.forecast !== null);
    if (act.length) out.push({ date: d, kind: "actual", revenue: sum(act.map((r) => r.actual!)).toFixed(2) });
    else if (fc.some((r) => r.basis === "po")) out.push({ date: d, kind: "po", revenue: sum(fc.map((r) => r.forecast!)).toFixed(2), kg: kgByDay[d] ?? null });
    else if (fc.length) out.push({ date: d, kind: "runrate", revenue: sum(fc.map((r) => r.forecast!)).toFixed(2) });
    else out.push({ date: d, kind: "none", revenue: "0" });
  }
  return out;
}

/** P&L lines of a valued v1 sales row (the weekly outlook's segment rules, statements.ts). */
export function salesLines(s: { segment: string; group: string }): { revenue_line: string; cogs_line: string } {
  if (s.segment === "Trading") return { revenue_line: "Revenue - Trading", cogs_line: "COGS - Trading" };
  return { revenue_line: s.group === "By-product" ? "Revenue - LB By Product" : "Revenue - LB Main Product", cogs_line: "COGS - Live Bird" };
}

/**
 * PO lines of a computed week delivering in [from, to], valued as the weekly outlook values them (kg × price;
 * cost = HPP of the order: kg × average stock cost of the key), times the demand-status weight (Confirmed 1,
 * Tentative / Forecast from the parameters).
 */
export function ordersFromWeek(sales: { status: string; date: ISODate | null; kg: Decimal; value: Decimal; hpp: Decimal; segment: string; group: string; src: { id?: string } }[], from: ISODate, to: ISODate, weight: (id: string | undefined) => Num): ForecastOrder[] {
  return sales.filter((s) => s.status === "Order" && s.date !== null && s.date >= from && s.date <= to).map((s) => {
    const w = D(weight(s.src.id));
    return { delivery_date: s.date!, kg: s.kg.times(w), revenue: s.value.times(w), cost: s.hpp.times(w), ...salesLines(s) };
  });
}

/** Delivered but not yet invoiced (Ops DO rows not superseded by an Accurate posting) in [from, to]: actual basis do_unbilled. */
export function unbilledFromWeek(sales: { status: string; date: ISODate | null; value: Decimal; hpp: Decimal; segment: string; group: string; src: { source?: string } }[], from: ISODate, to: ISODate): { date: ISODate; revenue_line: string; revenue: Decimal; cogs_line: string; cogs: Decimal }[] {
  return sales.filter((s) => s.status === "Aktual" && s.src.source === "Ops" && s.date !== null && s.date >= from && s.date <= to)
    .map((s) => ({ date: s.date!, revenue: s.value, cogs: s.hpp, ...salesLines(s) }));
}

export interface MonthSummary {
  actual: OutlookTotals;
  forecast: OutlookTotals;
  outlook: OutlookTotals;
  sharePo: Decimal;
  range: { revenueLow: Decimal; revenueHigh: Decimal; gpLow: Decimal; gpHigh: Decimal };
  /** Last day with actual rows. */
  lastActual: ISODate | null;
  remainingDays: number;
  budget: { revenue: Decimal | null; gp: Decimal | null; nibt: Decimal | null; needPerDay: Decimal | null; gpNeedPerDay: Decimal | null };
}

/** Everything /m/[month] shows from the data mart rows (pl_daily) — summed here, never in the page. */
export function monthSummary(rows: PlDailyRow[], month: ISODate, budget: { revenue: Num | null; gp: Num | null; nibt: Num | null } | null, tolerance: Num): MonthSummary {
  const t = sumRows(rows);
  const add = (a: OutlookTotals, b: OutlookTotals): OutlookTotals => ({ revenue: a.revenue.plus(b.revenue), cogs: a.cogs.plus(b.cogs), gp: a.gp.plus(b.gp), opex: a.opex.plus(b.opex), nibt: a.nibt.plus(b.nibt) });
  const outlook = add(t.actual, t.forecast);
  const tol = D(tolerance);
  const actualDates = rows.filter((r) => r.actual !== null).map((r) => r.date).sort();
  const lastActual = actualDates.length ? actualDates[actualDates.length - 1] : null;
  const end = monthEnd(month);
  const remainingDays = lastActual === null ? daysInMonth(month) : Math.max(0, diffDays(end, lastActual));
  const b = (v: Num | null | undefined) => (v === null || v === undefined || v === "" ? null : D(v));
  const bRev = b(budget?.revenue), bGp = b(budget?.gp);
  return {
    actual: t.actual, forecast: t.forecast, outlook, sharePo: sharePoRows(rows),
    range: {
      revenueLow: outlook.revenue.minus(t.forecast.revenue.abs().times(tol)), revenueHigh: outlook.revenue.plus(t.forecast.revenue.abs().times(tol)),
      gpLow: outlook.gp.minus(t.forecast.gp.abs().times(tol)), gpHigh: outlook.gp.plus(t.forecast.gp.abs().times(tol)),
    },
    lastActual, remainingDays,
    budget: {
      revenue: bRev, gp: bGp, nibt: b(budget?.nibt),
      needPerDay: bRev === null || remainingDays === 0 ? null : bRev.minus(t.actual.revenue).div(remainingDays),
      gpNeedPerDay: bGp === null || remainingDays === 0 ? null : bGp.minus(t.actual.gp).div(remainingDays),
    },
  };
}

/** Cumulative revenue per day (actual then forecast) for the chart table. */
export function cumulative(days: VersionDay[]): { date: ISODate; value: Decimal; cumulative: Decimal }[] {
  let c = ZERO;
  return days.map((d) => { c = c.plus(D(d.revenue)); return { date: d.date, value: D(d.revenue), cumulative: c }; });
}

/** Profit impact of the closing adjustments: all recorded, and only the posted ones. */
export function closingTotals(adj: { pl_line: string; amount: Num; posted: boolean }[]): { all: Decimal; posted: Decimal } {
  return { all: sum(adj.map((a) => D(a.amount))), posted: sum(adj.filter((a) => a.posted).map((a) => D(a.amount))) };
}
