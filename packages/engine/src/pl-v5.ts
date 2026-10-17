/**
 * PRD v5 §4.7 (K29–K31): the P&L of the month with the fixed costs not journaled yet, in two views, and the cumulative
 * series of five measures. Pure functions, decimal.js.
 *
 * K29: every P&L carries "Beban tetap belum dijurnal" (salary, depreciation, interest, rent) and "NIBT setelah beban
 * tetap". The nominal of a fixed line is the Finance schedule (template 8.3, K6); a line whose schedule row has no amount
 * takes its amount in the last FINAL month, labelled "estimasi bulan lalu" (C55). It is spread per calendar day. The
 * estimate of a day is what the journal and the forecast of that line do not carry yet, so the line's month never ends
 * below its nominal and never above max(nominal, journal + forecast) (K6: never twice).
 * K30: plTable('rr') = actual to the cut-off · PO + run-rate · outlook · % revenue · budget; plTable('wk') = calendar
 * weeks Monday–Sunday cut at the month's edges (the first partial week its own column) + the month.
 * K31: cumulativeSeries for revenue, COGS, GP, NIBT (journal) and NIBT after fixed costs, band ± tolerance × |forecast
 * part| on the forecast part only. COGS and GP per forecast day come from the rows of monthPlanV4 (PO days at the
 * order cost per kg, run-rate days at revenue × (1 − reference margin)).
 */
import { D, Decimal, ZERO, div, max, sum, type Num } from "./decimal";
import { addDays, daysInMonth, firstOfMonth, type ISODate } from "./dates";
import { isCogsLine, isRevenueLine, monthEnd } from "./monthly";
import { dailyFixed, monthlyAmount, type FixedCostRow } from "./drivers";
import { segmentOfLine, type PlRowV4 } from "./week-outlook";
import type { ControlV3 } from "./controls-v3";
import type { BudgetRow } from "./month-v4";

/** K29: the fixed lines when no schedule row is in force for the month (salary, depreciation, interest, rent). */
export const FIXED_LINES_K29 = ["Salaries and allowance", "Depreciation & amortisation", "Interest Expense", "Rent Expenses"];

export interface FixedNominal {
  pl_line: string;
  /** Cost of the month, positive; null = no schedule and no FINAL month (PRD v5.1 K51: never 0). */
  nominal: Decimal | null;
  source: "jadwal" | "estimasi bulan lalu" | "belum ada";
  /** Month of the FINAL the estimate comes from. */
  finalMonth: ISODate | null;
}

/**
 * Nominal per fixed line of the month (K29): the schedule rows in force (pro rata on their term); a line whose rows
 * have no amount → the line in the last FINAL month (P&L sign there, cost = −amount); nothing → null, "belum ada".
 * PRD v5.1 K51: the lines are the K29 lines (salary, depreciation, interest, rent) and every line scheduled that month
 * (Q-v5.1-17: a K29 line scheduled only outside the month is not a line of that month).
 */
export function fixedNominals(x: {
  month: ISODate; schedule: FixedCostRow[]; lastFinal: { month: ISODate; byLine: Record<string, Num> } | null;
  defaultLines?: string[]; isWorkingDay?: (d: ISODate) => boolean;
}): FixedNominal[] {
  const first = firstOfMonth(x.month), last = monthEnd(x.month);
  const inMonth = x.schedule.filter((r) => r.active && r.start_date <= last && (r.end_date === null || r.end_date >= first));
  // a K29 line whose schedule rows are all outside the month (rent from November) has no cost that month; a K29 line
  // without any schedule row falls back to the last FINAL month, else "belum ada"
  const scheduled = new Set(x.schedule.filter((r) => r.active).map((r) => r.pl_line));
  const inForce = new Set(inMonth.map((r) => r.pl_line));
  // R59: a scheduled line whose rows all ended before the month falls back to FINAL (estimasi), unlike a not-started
  // line (rent from November), which is simply absent in October.
  const ended = new Set(x.schedule.filter((r) => r.active && r.end_date !== null && r.end_date < first).map((r) => r.pl_line));
  const lines = [...new Set([...inMonth.map((r) => r.pl_line), ...(x.defaultLines ?? FIXED_LINES_K29).filter((l) => inForce.has(l) || !scheduled.has(l) || ended.has(l))])];
  return lines.map((pl_line): FixedNominal => {
    const rows = inMonth.filter((r) => r.pl_line === pl_line && monthlyAmount(r) !== null);
    if (rows.length) {
      let nominal = ZERO;
      for (let d = first; d <= last; d = addDays(d, 1)) nominal = nominal.plus(sum(dailyFixed(rows, d, x.isWorkingDay).map((a) => a.amount)));
      return { pl_line, nominal, source: "jadwal", finalMonth: null };
    }
    const fin = x.lastFinal?.byLine[pl_line];
    if (fin === undefined || fin === null || fin === "" || D(fin).isZero()) return { pl_line, nominal: null, source: "belum ada", finalMonth: x.lastFinal?.month ?? null };
    return { pl_line, nominal: max(ZERO, D(fin).neg()), source: "estimasi bulan lalu", finalMonth: x.lastFinal!.month };
  });
}

/**
 * Rows "Beban tetap belum dijurnal" (basis fixed_estimate, P&L sign) per day of the month: E(d) = max(0, nominal × day
 * ÷ calendar days − what the journal (to the cut-off) and the forecast (after it) carry for the line up to d); the row of
 * day d is E(d) − E(d − 1), actual up to the cut-off, forecast after it.
 */
export function fixedEstimateRows(x: { month: ISODate; cutOff: ISODate; nominals: FixedNominal[]; rows: PlRowV4[] }): PlRowV4[] {
  const first = firstOfMonth(x.month), dim = daysInMonth(x.month);
  const out: PlRowV4[] = [];
  for (const n of x.nominals) {
    if (n.nominal === null || n.nominal.isZero()) continue;
    const nominal = n.nominal;
    const line = x.rows.filter((r) => r.pl_line === n.pl_line && r.basis !== "fixed_estimate");
    let carried = ZERO, prev = ZERO;
    for (let i = 0; i < dim; i++) {
      const d = addDays(first, i), isActual = d <= x.cutOff;
      carried = carried.minus(sum(line.filter((r) => r.date === d).map((r) => (isActual ? r.actual : r.forecast) ?? ZERO)));
      const e = max(ZERO, nominal.times(i + 1).div(dim).minus(carried));
      const inc = e.minus(prev);
      prev = e;
      if (inc.isZero()) continue;
      out.push({ date: d, segment: segmentOfLine(n.pl_line), pl_line: n.pl_line, basis: "fixed_estimate", actual: isActual ? inc.neg() : null, forecast: isActual ? null : inc.neg(), kg: null, anomaly: false });
    }
  }
  return out;
}

/** C55: the P&L uses an estimated fixed cost (not the Finance schedule of the month). PERIKSA; V1 waits for it. */
export function c55(x: { month: ISODate; nominals: FixedNominal[] }): ControlV3 {
  const est = x.nominals.filter((n) => n.source !== "jadwal");
  const total = sum(est.filter((n) => n.nominal !== null).map((n) => n.nominal!));
  return {
    code: "C55", module: "M4", name: "Beban tetap bulan ini dari jadwal Finance (bukan estimasi)", value: D(est.length), comparator: ZERO, difference: D(est.length),
    status: est.length ? "PERIKSA" : "LULUS",
    action: est.length ? "Finance mengisi jadwal beban tetap bulan ini (template 8.3); sampai itu NIBT memakai estimasi bulan lalu" : "",
    detail: est.map((n) => (n.source === "belum ada" ? `${n.pl_line}: belum ada nominal` : `${n.pl_line}: estimasi bulan lalu (FINAL ${n.finalMonth?.slice(0, 7)}) Rp ${n.nominal!.toFixed(0)}`))
      .concat(est.length ? [`total estimasi Rp ${total.toFixed(0)}`] : []),
  };
}

/** Actual per P&L line of the rows (P&L sign, 2 decimals): a closed month's lines for the K29 fallback. */
export function lineTotals(rows: PlRowV4[]): Record<string, string> {
  const m = new Map<string, Decimal>();
  for (const r of rows) if (r.actual !== null && r.basis !== "fixed_estimate") m.set(r.pl_line, (m.get(r.pl_line) ?? ZERO).plus(r.actual));
  return Object.fromEntries([...m].map(([k, v]) => [k, v.toFixed(2)]));
}

// ------------------------------------------------------------------------------------------------ totals with the fixed costs

export interface PlTotalsV5 { revenue: Decimal; cogs: Decimal; gp: Decimal; opex: Decimal; nibt: Decimal; fixed: Decimal; nibtAfter: Decimal }

const valueOf = (r: PlRowV4) => (r.actual ?? ZERO).plus(r.forecast ?? ZERO);

/** Totals of rows (actual + forecast as they carry them): NIBT according to the journal, the fixed estimate, NIBT after it. */
export function plTotalsV5(rows: PlRowV4[], pick: (r: PlRowV4) => Decimal = valueOf): PlTotalsV5 {
  const j = rows.filter((r) => r.basis !== "fixed_estimate");
  const f = (p: (l: string) => boolean) => sum(j.filter((r) => p(r.pl_line)).map(pick));
  const revenue = f(isRevenueLine), cogs = f(isCogsLine), opex = f((l) => !isRevenueLine(l) && !isCogsLine(l));
  const fixed = sum(rows.filter((r) => r.basis === "fixed_estimate").map(pick));
  const nibt = revenue.plus(cogs).plus(opex);
  return { revenue, cogs, gp: revenue.plus(cogs), opex, nibt, fixed, nibtAfter: nibt.plus(fixed) };
}

/**
 * PRD v5.1 K52: the month's NIBT the solvency uses while v5_pl is on — NIBT after fixed costs (the fixed_estimate rows
 * included); unknown (null) when the month has no fixed nominal at all (K51), never NIBT without the fixed costs.
 */
export function solvencyNibtV5(rows: PlRowV4[], fixedMissing: boolean): Decimal | null {
  return fixedMissing ? null : plTotalsV5(rows).nibtAfter;
}

// ------------------------------------------------------------------------------------------------ K30 table

/** Calendar weeks Monday–Sunday of the month, cut at its first and last day. */
export function plWeeks(month: ISODate): { from: ISODate; to: ISODate }[] {
  const first = firstOfMonth(month), last = monthEnd(month);
  const out: { from: ISODate; to: ISODate }[] = [];
  for (let d = first; d <= last;) {
    const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
    const sunday = addDays(d, (7 - dow) % 7);
    const to = sunday < last ? sunday : last;
    out.push({ from: d, to });
    d = addDays(to, 1);
  }
  return out;
}

export type PlRowKey = "revenue" | "cogs" | "gp" | "gp_pct" | "opex" | "nibt" | "fixed" | "nibt_after" | "nibt_pct";
export const PL_TABLE_ROWS: { key: PlRowKey; label: string; pct: boolean; strong: 0 | 1 | 2 }[] = [
  { key: "revenue", label: "Revenue", pct: false, strong: 0 },
  { key: "cogs", label: "COGS", pct: false, strong: 0 },
  { key: "gp", label: "Gross profit", pct: false, strong: 1 },
  { key: "gp_pct", label: "GP %", pct: true, strong: 0 },
  { key: "opex", label: "Beban operasi (jurnal)", pct: false, strong: 0 },
  { key: "nibt", label: "NIBT menurut jurnal", pct: false, strong: 1 },
  { key: "fixed", label: "Beban tetap belum dijurnal (estimasi)", pct: false, strong: 0 },
  { key: "nibt_after", label: "NIBT setelah beban tetap", pct: false, strong: 2 },
  { key: "nibt_pct", label: "NIBT %", pct: true, strong: 0 },
];

export interface PlColumn {
  id: string;
  from: ISODate | null;
  to: ISODate | null;
  /** actual = up to the cut-off; forecast = after it; mixed = a week across the cut-off; total = the month; share = % of outlook revenue. */
  kind: "actual" | "forecast" | "mixed" | "total" | "share" | "budget";
  /** The highlighted week (the week of `highlight`). */
  current: boolean;
  /** Bases of the forecast revenue in the column ("po", "runrate"), for its label. */
  forecastBasis: ("po" | "runrate")[];
}

export interface PlTable {
  view: "rr" | "wk";
  month: ISODate;
  cutOff: ISODate;
  columns: PlColumn[];
  rows: { key: PlRowKey; label: string; pct: boolean; strong: 0 | 1 | 2; values: (Decimal | null)[] }[];
  outlook: PlTotalsV5;
  /** K51: no fixed nominal at all this month: "Beban tetap" and "NIBT setelah beban tetap" are unknown. */
  fixedMissing: boolean;
}

export interface PlBudget { revenue: Num | null; gp: Num | null; opex: Num | null; nibt: Num | null }

/** The month's budget for plTable (Σ segments; opex is entered as a positive cost, P&L sign here); null = no budget. */
export function plBudgetOf(rows: BudgetRow[]): PlBudget | null {
  if (!rows.length) return null;
  const tot = (m: BudgetRow["metric"]) => { const r = rows.filter((b) => b.metric === m); return r.length ? sum(r.map((b) => D(b.value))) : null; };
  const opex = tot("opex");
  return { revenue: tot("revenue")?.toString() ?? null, gp: tot("gp")?.toString() ?? null, opex: opex === null ? null : opex.neg().toString(), nibt: tot("nibt")?.toString() ?? null };
}

/** K51: with no fixed nominal at all (no schedule, no FINAL), the fixed row and NIBT after it are unknown, never 0. */
const rowValues = (t: PlTotalsV5, fixedMissing = false): Record<PlRowKey, Decimal | null> => ({
  revenue: t.revenue, cogs: t.cogs, gp: t.gp, gp_pct: t.revenue.isZero() ? null : div(t.gp, t.revenue), opex: t.opex, nibt: t.nibt,
  fixed: fixedMissing ? null : t.fixed, nibt_after: fixedMissing ? null : t.nibtAfter,
  nibt_pct: fixedMissing || t.revenue.isZero() ? null : div(t.nibtAfter, t.revenue),
});

/** K51: every fixed nominal of the month is missing (the list is not empty and no line has an amount). */
export const fixedAllMissing = (nominals: { nominal: unknown }[] | null | undefined) =>
  !!nominals && nominals.length > 0 && nominals.every((n) => n.nominal === null || n.nominal === undefined || n.nominal === "");

/**
 * K30: the P&L of the month in two views. Values per column are the rows' actual (to the cut-off) and forecast (after
 * it) in the column's dates; Σ of the week columns = the month. Budget (rr): revenue, COGS (= GP − revenue), GP, opex
 * and NIBT, the budget NIBT against NIBT after fixed costs (a budget carries every cost).
 */
export function plTable(view: "rr" | "wk", month: ISODate, opts: {
  rows: PlRowV4[]; cutOff: ISODate; budget?: PlBudget | null; split?: boolean; highlight?: ISODate | null;
  /** The fixed nominals of the month (K51); all missing → the fixed row and NIBT after it are null. */
  nominals?: { nominal: unknown }[] | null;
}): PlTable {
  const first = firstOfMonth(month), last = monthEnd(month);
  const missing = fixedAllMissing(opts.nominals);
  const rows = opts.rows.filter((r) => r.date >= first && r.date <= last);
  const inRange = (from: ISODate, to: ISODate) => plTotalsV5(rows.filter((r) => r.date >= from && r.date <= to));
  const kindOf = (from: ISODate, to: ISODate): PlColumn["kind"] => (to <= opts.cutOff ? "actual" : from > opts.cutOff ? "forecast" : "mixed");
  const outlook = inRange(first, last);
  const cols: { col: PlColumn; v: Record<PlRowKey, Decimal | null> }[] = [];
  const basisOf = (from: ISODate, to: ISODate) => (["po", "runrate"] as const).filter((b) => rows.some((r) => r.date >= from && r.date <= to && r.basis === b && r.forecast !== null && isRevenueLine(r.pl_line)));
  const add = (id: string, from: ISODate, to: ISODate, kind: PlColumn["kind"]) =>
    cols.push({ col: { id, from, to, kind, current: !!opts.highlight && opts.highlight >= from && opts.highlight <= to, forecastBasis: [...basisOf(from, to)] }, v: rowValues(inRange(from, to), missing) });
  if (view === "rr") {
    const cut = opts.cutOff < first ? addDays(first, -1) : opts.cutOff > last ? last : opts.cutOff;
    if (cut >= first) add("actual", first, cut, "actual");
    if (cut < last) add("forecast", addDays(cut, 1), last, "forecast");
    add("outlook", first, last, "total");
    const ov = rowValues(outlook, missing);
    cols.push({ col: { id: "share", from: null, to: null, kind: "share", current: false, forecastBasis: [] }, v: Object.fromEntries(PL_TABLE_ROWS.map((r) => [r.key, r.pct || outlook.revenue.isZero() || ov[r.key] === null ? null : div(ov[r.key]!, outlook.revenue)])) as Record<PlRowKey, Decimal | null> });
    const b = opts.budget ?? null;
    const n = (v: Num | null | undefined) => (v === null || v === undefined || v === "" ? null : D(v));
    const bRev = n(b?.revenue), bGp = n(b?.gp), bNibt = n(b?.nibt);
    cols.push({ col: { id: "budget", from: null, to: null, kind: "budget", current: false, forecastBasis: [] }, v: {
      revenue: bRev, cogs: bRev && bGp ? bGp.minus(bRev) : null, gp: bGp, gp_pct: bRev && bGp && !bRev.isZero() ? div(bGp, bRev) : null, opex: n(b?.opex),
      nibt: null, fixed: null, nibt_after: bNibt, nibt_pct: bRev && bNibt && !bRev.isZero() ? div(bNibt, bRev) : null,
    } });
  } else {
    for (const w of plWeeks(month)) {
      const k = kindOf(w.from, w.to);
      if (k === "mixed" && opts.split) {
        add(`${w.from}:a`, w.from, opts.cutOff, "actual");
        add(`${w.from}:f`, addDays(opts.cutOff, 1), w.to, "forecast");
      } else add(w.from, w.from, w.to, k);
    }
    add("month", first, last, "total");
  }
  return {
    view, month: first, cutOff: opts.cutOff, columns: cols.map((c) => c.col), outlook, fixedMissing: missing,
    rows: PL_TABLE_ROWS.map((r) => ({ ...r, values: cols.map((c) => c.v[r.key]) })),
  };
}

// ------------------------------------------------------------------------------------------------ K31 cumulative series

export type CumulativeMetric = "revenue" | "cogs" | "gp" | "nibt" | "nibt_after";
export const CUMULATIVE_METRICS: { key: CumulativeMetric; label: string }[] = [
  { key: "revenue", label: "Revenue" }, { key: "cogs", label: "COGS" }, { key: "gp", label: "Gross profit" },
  { key: "nibt", label: "NIBT jurnal" }, { key: "nibt_after", label: "NIBT + beban tetap" },
];

export interface CumulativeSeries {
  metric: CumulativeMetric;
  dates: ISODate[];
  /** Value of the day (COGS positive, as a cost). */
  daily: Decimal[];
  actual: (Decimal | null)[];
  /** From the cut-off day (joining the actual line) to the month end. */
  outlook: (Decimal | null)[];
  low: (Decimal | null)[];
  high: (Decimal | null)[];
  cutIndex: number;
  mtd: Decimal | null;
  total: Decimal;
  bandLow: Decimal;
  bandHigh: Decimal;
}

/** K31: running total of a measure over the month; band ± tolerance × |running forecast part| after the cut-off only. */
export function cumulativeSeries(metric: CumulativeMetric, month: ISODate, rows: PlRowV4[], cutOff: ISODate, tolerance: Num): CumulativeSeries {
  const first = firstOfMonth(month), n = daysInMonth(month), tol = D(tolerance);
  const pick = (t: PlTotalsV5) => (metric === "revenue" ? t.revenue : metric === "cogs" ? t.cogs.neg() : metric === "gp" ? t.gp : metric === "nibt" ? t.nibt : t.nibtAfter);
  const dates: ISODate[] = [], daily: Decimal[] = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(first, i);
    dates.push(d);
    daily.push(pick(plTotalsV5(rows.filter((r) => r.date === d))));
  }
  const cutIndex = dates.filter((d) => d <= cutOff).length - 1;
  const actual: (Decimal | null)[] = [], outlook: (Decimal | null)[] = [], low: (Decimal | null)[] = [], high: (Decimal | null)[] = [];
  let cum = ZERO;
  const base = cutIndex >= 0 ? sum(daily.slice(0, cutIndex + 1)) : ZERO;
  daily.forEach((v, i) => {
    cum = cum.plus(v);
    const isActual = i <= cutIndex;
    actual.push(isActual ? cum : null);
    const onOutlook = i >= cutIndex;
    const fpart = cum.minus(base);
    outlook.push(onOutlook ? cum : null);
    low.push(onOutlook && i > cutIndex ? cum.minus(fpart.abs().times(tol)) : null);
    high.push(onOutlook && i > cutIndex ? cum.plus(fpart.abs().times(tol)) : null);
  });
  const total = cum, fpart = total.minus(base);
  return {
    metric, dates, daily, actual, outlook, low, high, cutIndex, mtd: cutIndex >= 0 ? base : null, total,
    bandLow: total.minus(fpart.abs().times(tol)), bandHigh: total.plus(fpart.abs().times(tol)),
  };
}
