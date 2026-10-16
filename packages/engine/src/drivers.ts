/**
 * M5 — cost drivers (PRD v3 §4.6). Pure functions, decimal.js.
 *
 * Fixed costs follow `fixed_cost_schedule`: per day = monthly amount / calendar days of the month for dates inside
 * [start, end]; a prepaid amortised over its term without a monthly amount = prepaid total / months of the term.
 * The month outlook of a fixed line = actual MTD (journal) + max(0, scheduled month − actual MTD): never twice.
 * Variable costs = Rp/kg × kg (M3 forecast); run-rate lines = monthly amount / working days of the month per working day.
 *
 * PRD v4 K6 (template 8.3): a fixed row also carries day_basis (calendar | working), posting_day, basis_doc, owner and
 * version; a fixed line without an input for the running month carries last month's nominal forward and is labelled
 * "belum diperbarui" (C43); one-off costs are cost events, never averaged into a run-rate.
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
  /** K6: calendar days (default) or working days; the day count that divides the monthly nominal. */
  day_basis?: "calendar" | "working";
  /** K6: day of the month the cost is usually booked (salary 25, rent 1, interest month end). */
  posting_day?: number | null;
  basis_doc?: string | null;
  owner?: string | null;
  version?: number;
  /** Chart of accounts account of the row (the template has one row per COA per period). */
  account?: string | null;
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

/** Working days of a month (default Monday–Saturday, the RPA week) — declared here for dailyFixed; see also workingDays. */
function workingDaysOf(month: ISODate, isWorkingDay?: (d: ISODate) => boolean): number {
  const first = firstOfMonth(month);
  let n = 0;
  for (let i = 0; i < daysInMonth(month); i++) {
    const d = addDays(first, i);
    if (isWorkingDay ? isWorkingDay(d) : new Date(`${d}T00:00:00Z`).getUTCDay() !== 0) n++;
  }
  return n;
}

/**
 * Normal fixed cost of one day per row (K6): nominal / days of the month on the row's day basis, inside the term. A
 * 'working' row costs nothing on a Sunday or a holiday and nominal / working days on the others.
 */
export function dailyFixed(schedule: FixedCostRow[], date: ISODate, isWorkingDay?: (d: ISODate) => boolean): { id: string; pl_line: string; amount: Decimal }[] {
  const out: { id: string; pl_line: string; amount: Decimal }[] = [];
  for (const r of schedule.filter((x) => inTerm(x, date))) {
    const m = monthlyAmount(r) ?? ZERO;
    if (r.day_basis === "working") {
      const works = isWorkingDay ? isWorkingDay(date) : new Date(`${date}T00:00:00Z`).getUTCDay() !== 0;
      out.push({ id: r.id, pl_line: r.pl_line, amount: works ? m.div(workingDaysOf(date, isWorkingDay)) : ZERO });
    } else out.push({ id: r.id, pl_line: r.pl_line, amount: m.div(daysInMonth(date)) });
  }
  return out;
}

export interface CarriedRow { row: FixedCostRow; carriedFrom: ISODate }

/**
 * C43 input (K6): a fixed row whose term ended before the month, with no row of the same account / code / line active
 * in the month, is carried forward with last month's nominal and labelled "belum diperbarui". Returns the synthetic
 * rows (term extended over the month) and what was carried.
 */
export function carryForwardFixed(schedule: FixedCostRow[], month: ISODate): { schedule: FixedCostRow[]; carried: CarriedRow[] } {
  const first = firstOfMonth(month), last = lastOfMonth(month);
  const key = (r: FixedCostRow) => r.code ?? `${r.pl_line}|${r.account ?? ""}`;
  const activeKeys = new Set(schedule.filter((r) => r.active && r.start_date <= last && (r.end_date === null || r.end_date >= first)).map(key));
  const latest = new Map<string, FixedCostRow>();
  for (const r of schedule) {
    if (!r.active || r.end_date === null || r.end_date >= first || activeKeys.has(key(r)) || monthlyAmount(r) === null) continue;
    const o = latest.get(key(r));
    if (!o || (o.end_date as string) < r.end_date) latest.set(key(r), r);
  }
  const carried: CarriedRow[] = [];
  const extra: FixedCostRow[] = [];
  for (const r of latest.values()) {
    // only a row that ended in the previous month is "last month's nominal"; older ones ended for a reason
    if (addDays(r.end_date as string, 1) !== first && (r.end_date as string) < addDays(first, -1)) continue;
    carried.push({ row: r, carriedFrom: r.end_date as string });
    extra.push({ ...r, id: `${r.id}:carry`, start_date: first, end_date: null, amortize: false, prepaid_total: null, amount_per_month: monthlyAmount(r)!.toString() });
  }
  return { schedule: [...schedule, ...extra], carried };
}

/** C43: fixed lines of the running month that use last month's nominal ("belum diperbarui", PERIKSA in the register). */
export function fixedFreshnessControl(carried: CarriedRow[]): ControlV3 {
  return {
    code: "C43", module: "M5", name: "Biaya tetap bulan berjalan sudah diperbarui (bukan nominal bulan lalu)",
    value: D(carried.length), comparator: ZERO, difference: D(carried.length), status: carried.length ? "PERIKSA" : "LULUS",
    action: carried.length ? "Perbarui nominal bulan ini di Biaya tetap & driver" : "",
    detail: carried.map((c) => `${c.row.pl_line}${c.row.account ? ` ${c.row.account}` : ""}: nominal bulan lalu dipakai (sampai ${c.carriedFrom})`),
  };
}

export interface CostEventRow { date: ISODate; pl_line: string; amount: Num }

/**
 * Actual cost per line without the one-off costs booked as cost events (K6: events are never averaged into a run-rate).
 * actualByLine is positive = cost; the event amounts are negative = cost like the P&L rows.
 */
export function withoutEvents(actualByLine: Record<string, Decimal>, events: CostEventRow[], from: ISODate, to: ISODate): Record<string, Decimal> {
  const out = { ...actualByLine };
  for (const e of events) if (e.date >= from && e.date <= to && out[e.pl_line] !== undefined) out[e.pl_line] = out[e.pl_line].plus(D(e.amount));
  return out;
}

export interface FixedOutlookLine {
  pl_line: string;
  /** K6: 'working' only when every row of the line is on the working day basis. */
  day_basis: "calendar" | "working";
  /** Σ of the rows' daily amounts over the days of the month inside their term. */
  scheduled: Decimal;
  actual_mtd: Decimal;
  outlook: Decimal;
  /** What is left to book this month: max(0, scheduled − actual MTD) (§3.3). */
  remaining: Decimal;
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
    const l = lines.get(r.pl_line) ?? { pl_line: r.pl_line, day_basis: "working" as const, scheduled: ZERO, actual_mtd: D(actualMtd[r.pl_line] ?? 0), outlook: ZERO, remaining: ZERO, missing: [], over: false };
    if (r.day_basis !== "working") l.day_basis = "calendar";
    if (m === null) l.missing.push(r.description);
    else l.scheduled = l.scheduled.plus(m.times(n).div(days));
    lines.set(r.pl_line, l);
  }
  for (const l of lines.values()) {
    l.remaining = max(ZERO, l.scheduled.minus(l.actual_mtd));
    l.outlook = l.actual_mtd.plus(l.remaining);
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
