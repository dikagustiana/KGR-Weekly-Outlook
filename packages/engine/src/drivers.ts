/**
 * M5 — cost drivers (PRD v3 §4.6). Pure functions, decimal.js.
 *
 * Fixed costs follow `fixed_cost_schedule`: per day = monthly amount / calendar days of the month for dates inside
 * [start, end]; a prepaid amortised over its term without a monthly amount = prepaid total / months of the term.
 * The month outlook of a fixed line = actual MTD (journal) + max(0, scheduled month − actual MTD): never twice.
 * Variable costs = Rp/kg × kg (M3 forecast); run-rate lines = monthly amount / working days of the month per working day.
 */
import { D, Decimal, ZERO, max, sum, type Num } from "./decimal";
import { addDays, daysInMonth, diffDays, firstOfMonth, type ISODate } from "./dates";
import type { ControlV3 } from "./controls-v3";

export interface FixedCostRow {
  id: string;
  code?: string | null;
  pl_line: string;
  description: string;
  amount_per_month: Num | null;
  start_date: ISODate;
  end_date: ISODate | null;
  amortize: boolean;
  prepaid_total: Num | null;
  intercompany?: boolean;
  active: boolean;
}

const lastOfMonth = (d: ISODate): ISODate => addDays(firstOfMonth(d), daysInMonth(d) - 1);

/** Whole months from the start date's month to the end date's month (inclusive). */
export function monthsOfTerm(start: ISODate, end: ISODate): number {
  const [ys, ms] = start.split("-").map(Number);
  const [ye, me] = end.split("-").map(Number);
  return (ye - ys) * 12 + (me - ms) + 1;
}

/** Monthly amount of a schedule row: its own amount, else (amortised prepaid) total / months of the term; null = not set. */
export function monthlyAmount(r: FixedCostRow): Decimal | null {
  if (r.amount_per_month !== null && r.amount_per_month !== undefined && r.amount_per_month !== "") return D(r.amount_per_month);
  if (r.amortize && r.prepaid_total !== null && r.prepaid_total !== undefined && r.prepaid_total !== "" && r.end_date) {
    return D(r.prepaid_total).div(monthsOfTerm(r.start_date, r.end_date));
  }
  return null;
}

const inTerm = (r: FixedCostRow, d: ISODate) => r.active && d >= r.start_date && (r.end_date === null || d <= r.end_date);

/** Fixed cost of one day per row (amount / calendar days of the month, inside the term). */
export function dailyFixed(schedule: FixedCostRow[], date: ISODate): { id: string; pl_line: string; amount: Decimal }[] {
  const days = daysInMonth(date);
  return schedule.filter((r) => inTerm(r, date)).map((r) => ({ id: r.id, pl_line: r.pl_line, amount: (monthlyAmount(r) ?? ZERO).div(days) }));
}

export interface FixedOutlookLine {
  pl_line: string;
  /** Σ of the rows' daily amounts over the days of the month inside their term. */
  scheduled: Decimal;
  actual_mtd: Decimal;
  outlook: Decimal;
  /** Rows of the line without an amount (Finance must fill them). */
  missing: string[];
  over: boolean;
}

/** Month outlook per fixed line: actual MTD + max(0, scheduled − actual MTD). */
export function monthFixedOutlook(schedule: FixedCostRow[], actualMtd: Record<string, Num>, month: ISODate): FixedOutlookLine[] {
  const first = firstOfMonth(month), last = lastOfMonth(month), days = daysInMonth(month);
  const lines = new Map<string, FixedOutlookLine>();
  for (const r of schedule) {
    if (!r.active || r.start_date > last || (r.end_date !== null && r.end_date < first)) continue;
    const from = r.start_date > first ? r.start_date : first;
    const to = r.end_date !== null && r.end_date < last ? r.end_date : last;
    const n = diffDays(to, from) + 1;
    const m = monthlyAmount(r);
    const l = lines.get(r.pl_line) ?? { pl_line: r.pl_line, scheduled: ZERO, actual_mtd: D(actualMtd[r.pl_line] ?? 0), outlook: ZERO, missing: [], over: false };
    if (m === null) l.missing.push(r.description);
    else l.scheduled = l.scheduled.plus(m.times(n).div(days));
    lines.set(r.pl_line, l);
  }
  for (const l of lines.values()) {
    l.outlook = l.actual_mtd.plus(max(ZERO, l.scheduled.minus(l.actual_mtd)));
    l.over = l.actual_mtd.gt(l.scheduled) && l.missing.length === 0;
  }
  return [...lines.values()].sort((a, b) => a.pl_line.localeCompare(b.pl_line));
}

export function variableCost(rpPerKg: Num, kg: Num): Decimal {
  return D(rpPerKg).times(D(kg));
}

/** Working days of a month (default Monday–Saturday, the RPA week). */
export function workingDays(month: ISODate, weekdays: number[] = [1, 2, 3, 4, 5, 6]): ISODate[] {
  const first = firstOfMonth(month);
  return Array.from({ length: daysInMonth(month) }, (_, i) => addDays(first, i)).filter((d) => weekdays.includes(new Date(`${d}T00:00:00Z`).getUTCDay()));
}

/** Run-rate per working day: monthly amount / working days. */
export function runrateDaily(monthlyAmountValue: Num, workingDayCount: number): Decimal {
  return workingDayCount > 0 ? D(monthlyAmountValue).div(workingDayCount) : ZERO;
}

/** Cost per P&L line from journal lines in [from, to]: Σ (debit − credit) of the accounts mapped to the line. */
export function costActualByLine(gl: { date: ISODate | null; account: string | null; debit: Num | null; credit: Num | null }[], coa: { account: string; pl_line: string | null }[], from: ISODate, to: ISODate): Record<string, Decimal> {
  const lineOf = new Map(coa.filter((c) => c.pl_line).map((c) => [c.account, c.pl_line as string]));
  const out: Record<string, Decimal> = {};
  for (const g of gl) {
    if (!g.date || g.date < from || g.date > to || !g.account) continue;
    const l = lineOf.get(g.account);
    if (!l) continue;
    out[l] = (out[l] ?? ZERO).plus(D(g.debit ?? 0)).minus(D(g.credit ?? 0));
  }
  return out;
}

/**
 * C33: every cost P&L line in the chart of accounts has a driver (BELUM DIISI otherwise).
 * C34: a fixed line whose actual MTD exceeds its schedule (PERIKSA).
 */
export function driverControls(x: { costLines: { pl_line: string; driver_type: string | null }[]; fixed: FixedOutlookLine[] }): ControlV3[] {
  const byLine = new Map<string, string[]>();
  for (const c of x.costLines) byLine.set(c.pl_line, [...(byLine.get(c.pl_line) ?? []), c.driver_type ?? "none"]);
  const noDriver = [...byLine.entries()].filter(([, ts]) => ts.every((t) => t === "none")).map(([l]) => l).sort();
  const over = x.fixed.filter((f) => f.over);
  const n = (v: number) => D(v);
  return [
    {
      code: "C33", module: "M5", name: "Setiap pos biaya P&L punya driver (tetap / variabel / run-rate)",
      value: n(noDriver.length), comparator: n(0), difference: n(noDriver.length),
      status: byLine.size === 0 ? "BELUM DIISI" : noDriver.length ? "BELUM DIISI" : "LULUS",
      action: noDriver.length ? "Isi driver di Biaya (COA) untuk pos berikut" : "", detail: noDriver,
    },
    {
      code: "C34", module: "M5", name: "Biaya tetap: actual MTD tidak melebihi jadwal",
      value: n(over.length), comparator: n(0), difference: over.reduce((m, f) => max(m, f.actual_mtd.minus(f.scheduled)), ZERO),
      status: x.fixed.length === 0 ? "BELUM DIISI" : over.length ? "PERIKSA" : "LULUS",
      action: over.length ? "Periksa jurnal ganda atau jadwal yang kurang" : "",
      detail: over.map((f) => `${f.pl_line}: actual ${f.actual_mtd.toFixed(0)} > jadwal ${f.scheduled.toFixed(0)}`),
    },
  ];
}

/** Σ helper for callers that need a month total of fixed outlook lines. */
export function fixedTotals(lines: FixedOutlookLine[]): { scheduled: Decimal; actual_mtd: Decimal; outlook: Decimal } {
  return { scheduled: sum(lines.map((l) => l.scheduled)), actual_mtd: sum(lines.map((l) => l.actual_mtd)), outlook: sum(lines.map((l) => l.outlook)) };
}
