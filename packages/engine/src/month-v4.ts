/**
 * M4 v4 (PRD v4 §3.2 P1–P14, K3, K5, K6, K9, K11, K12): the monthly outlook as P&L rows per day × segment × line × basis
 * (the data mart pl_daily_v4), the register of assumptions, the checks behind locking V1, the V1 → V2 bridge for revenue,
 * GP and NIBT, the comparison with the budget and the accuracy against FINAL. Pure functions, decimal.js; the page and
 * the rebuild job never add a number themselves (K17).
 *
 * The weekly rows come from the same function: weekOutlook (week-outlook.ts) reads the 7 days of the week out of the
 * month's rows, so a week and its month are one number (§3.4).
 */
import { D, Decimal, ZERO, div, max, sum, type Num } from "./decimal";
import { addDays, daysInMonth, diffDays, firstOfMonth, type ISODate } from "./dates";
import type { ControlV3 } from "./controls-v3";
import { gpPctMtd, isCogsLine, isOpexLine, isRevenueLine, monthEnd, runrateRevenue, v1LockDate, type CostingRowsMode, type ForecastOrder, type RunRate } from "./monthly";
import { segmentOfLine, type PlRowV4, type PlSegment } from "./week-outlook";

const SEGMENTS3: Exclude<PlSegment, "Umum">[] = ["LB main", "LB by-product", "Trading"];
const REVENUE_LINE: Record<Exclude<PlSegment, "Umum">, string> = { "LB main": "Revenue - LB Main Product", "LB by-product": "Revenue - LB By Product", Trading: "Revenue - Trading" };
const COGS_LINE: Record<Exclude<PlSegment, "Umum">, string> = { "LB main": "COGS - Live Bird", "LB by-product": "COGS - Live Bird", Trading: "COGS - Trading" };

// ------------------------------------------------------------------------------------------------ totals

export interface PlTotalsV4 { revenue: Decimal; cogs: Decimal; gp: Decimal; opex: Decimal; nibt: Decimal }

export function totalsV4(rows: PlRowV4[], v: "actual" | "forecast", basis?: (b: PlRowV4["basis"]) => boolean, mode: CostingRowsMode = "cogs"): PlTotalsV4 {
  // v5 fixed-cost estimate rows are not journal: never inside the v4 totals (plTotalsV5 adds them, K29)
  const f = (p: (l: string) => boolean) => sum(rows.filter((r) => p(r.pl_line) && r.basis !== "fixed_estimate" && (!basis || basis(r.basis))).map((r) => r[v] ?? ZERO));
  // R66 (K63): in mode 'memo' the two v5 costing rows are in no total (COGS, opex, GP, NIBT)
  const revenue = f(isRevenueLine), cogs = f((l) => isCogsLine(l, mode)), opex = f((l) => isOpexLine(l, mode));
  return { revenue, cogs, gp: revenue.plus(cogs), opex, nibt: revenue.plus(cogs).plus(opex) };
}

const addT = (a: PlTotalsV4, b: PlTotalsV4): PlTotalsV4 => ({ revenue: a.revenue.plus(b.revenue), cogs: a.cogs.plus(b.cogs), gp: a.gp.plus(b.gp), opex: a.opex.plus(b.opex), nibt: a.nibt.plus(b.nibt) });

// ------------------------------------------------------------------------------------------------ P1 actual rows

/** Journal lines (and delivered-not-invoiced DOs, K11) → rows per day × segment × line; revenue positive, costs negative. */
export function actualRowsV4(x: {
  gl: { date: ISODate | null; account: string | null; debit: Num | null; credit: Num | null }[];
  coa: { account: string; pl_line: string | null; segment?: string | null }[];
  from: ISODate;
  to: ISODate;
  unbilled?: { date: ISODate; revenue_line: string; revenue: Num; cogs_line: string; cogs: Num; segment?: PlSegment; kg?: Num }[];
}): PlRowV4[] {
  const info = new Map(x.coa.filter((c) => c.pl_line).map((c) => [c.account, { line: c.pl_line as string, segment: (c.segment as PlSegment | null | undefined) ?? null }]));
  const m = new Map<string, PlRowV4>();
  const add = (date: ISODate, segment: PlSegment, line: string, basis: PlRowV4["basis"], v: Decimal, kg: Decimal | null = null) => {
    const k = `${date}|${segment}|${line}|${basis}`;
    const r = m.get(k) ?? { date, segment, pl_line: line, basis, actual: ZERO, forecast: null, kg: null, anomaly: false };
    r.actual = (r.actual ?? ZERO).plus(v);
    if (kg) r.kg = (r.kg ?? ZERO).plus(kg);
    m.set(k, r);
  };
  for (const g of x.gl) {
    if (!g.date || g.date < x.from || g.date > x.to || !g.account) continue;
    const i = info.get(g.account);
    if (i) add(g.date, i.segment ?? segmentOfLine(i.line), i.line, "journal", D(g.credit ?? 0).minus(D(g.debit ?? 0)));
  }
  for (const u of x.unbilled ?? []) {
    if (u.date < x.from || u.date > x.to) continue;
    const seg = u.segment ?? segmentOfLine(u.revenue_line);
    add(u.date, seg, u.revenue_line, "do_unbilled", D(u.revenue), u.kg ? D(u.kg) : null);
    add(u.date, seg, u.cogs_line, "do_unbilled", D(u.cogs).neg());
  }
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.segment.localeCompare(b.segment) || a.pl_line.localeCompare(b.pl_line) || a.basis.localeCompare(b.basis));
}

/** Revenue and COGS per day (journal basis only, P3 input) from rows. */
export function dailyFromRows(rows: PlRowV4[], basis: (b: PlRowV4["basis"]) => boolean = (b) => b === "journal"): Map<ISODate, { revenue: Decimal; cogs: Decimal }> {
  const out = new Map<ISODate, { revenue: Decimal; cogs: Decimal }>();
  for (const r of rows) {
    if (r.actual === null || !basis(r.basis)) continue;
    const t = out.get(r.date) ?? { revenue: ZERO, cogs: ZERO };
    if (isRevenueLine(r.pl_line)) t.revenue = t.revenue.plus(r.actual);
    else if (isCogsLine(r.pl_line)) t.cogs = t.cogs.plus(r.actual);
    out.set(r.date, t);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ P3 run-rate per segment

export interface RunRateV4 extends RunRate {
  bySegment: Record<Exclude<PlSegment, "Umum">, Decimal>;
  /** Mean actual revenue per working day of the window, anomaly days included (the P8 test compares against it). */
  meanActualWindow: Decimal;
}

export function runrateV4(x: { rows: PlRowV4[]; cutOff: ISODate; isWorkingDay: (d: ISODate) => boolean; holidays?: ISODate[]; windowDays?: number; sigma?: number }): RunRateV4 {
  const journal = x.rows.filter((r) => r.basis === "journal" && r.actual !== null && isRevenueLine(r.pl_line));
  const byDay = new Map<ISODate, Decimal>();
  for (const r of journal) byDay.set(r.date, (byDay.get(r.date) ?? ZERO).plus(r.actual!));
  const rr = runrateRevenue({ revenueByDay: byDay, cutOff: x.cutOff, isWorkingDay: x.isWorkingDay, holidays: x.holidays, windowDays: x.windowDays, sigma: x.sigma });
  const used = new Set(rr.days);
  const bySegment = Object.fromEntries(SEGMENTS3.map((s) => [s, rr.days.length ? sum(journal.filter((r) => r.segment === s && used.has(r.date)).map((r) => r.actual!)).div(rr.days.length) : ZERO])) as RunRateV4["bySegment"];
  const working: ISODate[] = [];
  for (let d = rr.windowFrom; d <= x.cutOff; d = addDays(d, 1)) if (x.isWorkingDay(d) && !(x.holidays ?? []).includes(d)) working.push(d);
  return { ...rr, bySegment, meanActualWindow: working.length ? sum(working.map((d) => byDay.get(d) ?? ZERO)).div(working.length) : ZERO };
}

// ------------------------------------------------------------------------------------------------ P6 opex (M5)

export interface FixedLineInput {
  pl_line: string;
  scheduled: Decimal;
  actual_mtd: Decimal;
  /** 'working' spreads the rest over the remaining working days, 'calendar' over every remaining day (K6). */
  day_basis: "calendar" | "working";
  /** Rows of the line without an amount: nothing is forecast for the line. */
  missing: boolean;
}

export interface OpexInputV4 {
  fixed: FixedLineInput[];
  /** Cost actuals of the month so far per run-rate line, positive = cost, without the amounts booked as cost events. */
  runrateActual: { pl_line: string; actual_mtd: Num }[];
  /** v1 I_RunRate monthly amounts: used only for a run-rate line without actuals this month. */
  runrateTable: { pl_line: string; monthly: Num }[];
  variable: { pl_line: string; rp_per_kg: Num }[];
  /** One-off costs dated after the cut-off; never averaged (negative = cost). */
  events: { date: ISODate; pl_line: string; amount: Num }[];
}

/**
 * Cost rows of the forecast days (K6, §3.3): fixed lines = max(0, nominal − actual MTD) spread over the remaining
 * days; variable lines = Rp/kg × the kg of the PO days; run-rate lines = the average actual day of the month;
 * events on their own date. A fixed line wins over a variable or run-rate line of the same name.
 * On a run-rate day the GP is revenue × the reference margin (P6), and that margin is GP P&L ÷ revenue, which already
 * carries every mapped COGS line (expedition, blasting): COGS-type lines are not added again on those days.
 */
export function opexRowsV4(x: {
  month: ISODate; cutOff: ISODate; isWorkingDay: (d: ISODate) => boolean; holidays?: ISODate[];
  input: OpexInputV4; kgByDay: Map<ISODate, Decimal>;
  /** Run-rate days: no COGS-type cost row (the margin covers it). */
  marginDays?: Set<ISODate>;
}): PlRowV4[] {
  const first = firstOfMonth(x.month), last = monthEnd(x.month), dim = daysInMonth(x.month);
  const remaining: ISODate[] = [];
  for (let d = addDays(x.cutOff, 1); d <= last; d = addDays(d, 1)) remaining.push(d);
  if (!remaining.length) return [];
  const working = remaining.filter((d) => x.isWorkingDay(d) && !(x.holidays ?? []).includes(d));
  const elapsed = Math.max(1, diffDays(x.cutOff, first) + 1);
  const out: PlRowV4[] = [];
  const add = (date: ISODate, line: string, basis: PlRowV4["basis"], v: Decimal, kg: Decimal | null = null) => {
    if (v.isZero()) return;
    if (basis !== "event" && isCogsLine(line) && x.marginDays?.has(date)) return;
    out.push({ date, segment: segmentOfLine(line), pl_line: line, basis, actual: null, forecast: v, kg, anomaly: false });
  };
  const fixedLines = new Set<string>();
  for (const f of x.input.fixed) {
    if (f.missing && f.scheduled.isZero()) continue;
    fixedLines.add(f.pl_line);
    const rest = max(ZERO, f.scheduled.minus(f.actual_mtd));
    const days = f.day_basis === "working" && working.length ? working : remaining;
    for (const d of days) add(d, f.pl_line, "fixed", rest.div(days.length).neg());
  }
  const varLines = new Set<string>();
  for (const v of x.input.variable) {
    if (fixedLines.has(v.pl_line)) continue;
    varLines.add(v.pl_line);
    for (const [d, kg] of x.kgByDay) if (d > x.cutOff && d <= last) add(d, v.pl_line, "variable", D(v.rp_per_kg).times(kg).neg(), kg);
  }
  const actualLines = new Map(x.input.runrateActual.map((r) => [r.pl_line, D(r.actual_mtd)]));
  const lines = new Set([...x.input.runrateTable.map((r) => r.pl_line), ...actualLines.keys()]);
  for (const line of lines) {
    if (fixedLines.has(line) || varLines.has(line)) continue;
    const a = actualLines.get(line);
    const table = x.input.runrateTable.find((r) => r.pl_line === line);
    // average actual day of the month; a line without actuals this month falls back to the v1 monthly amount
    const perDay = a && !a.isZero() ? a.div(elapsed) : table ? D(table.monthly).div(dim) : ZERO;
    const sign = line === "Other Income" ? 1 : -1;
    for (const d of remaining) add(d, line, "runrate", perDay.times(sign));
  }
  for (const e of x.input.events) if (e.date > x.cutOff && e.date <= last) add(e.date, e.pl_line, "event", D(e.amount));
  return out;
}

// ------------------------------------------------------------------------------------------------ P2, P3, P6 forecast rows

export interface OrderV4 extends ForecastOrder {
  segment: PlSegment;
  /** false = no cost per kg for the SKU (the plan cost is missing): V1 cannot be locked (P6). */
  costKnown: boolean;
}

export interface MonthPlanV4 {
  rows: PlRowV4[];
  runrate: RunRateV4;
  margin: Decimal;
  /** Days of the forecast without PO and the basis their revenue has. */
  days: { date: ISODate; kind: "po" | "runrate" | "none"; revenue: Decimal; kg: Decimal | null }[];
  poRevenue: Decimal;
  runrateRevenue: Decimal;
  costMissingKeys: number;
}

/** The month as rows: actual (journal, DO unbilled) up to the cut-off, forecast (PO, run-rate, M5 drivers) after it. */
export function monthPlanV4(x: {
  month: ISODate;
  cutOff: ISODate;
  actualRows: PlRowV4[];
  orders: OrderV4[];
  opex: OpexInputV4;
  isWorkingDay: (d: ISODate) => boolean;
  holidays?: ISODate[];
  windowDays?: number;
}): MonthPlanV4 {
  const last = monthEnd(x.month);
  const runrate = runrateV4({ rows: x.actualRows, cutOff: x.cutOff, isWorkingDay: x.isWorkingDay, holidays: x.holidays, windowDays: x.windowDays });
  const daily = dailyFromRows(x.actualRows, (b) => b === "journal");
  const margin = gpPctMtd(daily, x.month, x.cutOff);
  const rows: PlRowV4[] = x.actualRows.filter((r) => r.date >= firstOfMonth(x.month) && r.date <= x.cutOff).map((r) => ({ ...r, anomaly: r.anomaly || runrate.anomalies.some((a) => a.date === r.date) }));
  // an anomaly day with no row at all (25 Aug: no journal, no DO) still has to show up: a row without amounts marks it
  // (missing data, K12), never a 0
  for (const a of runrate.anomalies) if (a.date >= firstOfMonth(x.month) && !rows.some((r) => r.date === a.date && r.actual !== null)) {
    rows.push({ date: a.date, segment: "Trading", pl_line: REVENUE_LINE.Trading, basis: "journal", actual: null, forecast: null, kg: null, anomaly: true });
  }
  const kgByDay = new Map<ISODate, Decimal>();
  const poDays = new Set<ISODate>();
  const days: MonthPlanV4["days"] = [];
  let poRevenue = ZERO, rrRevenue = ZERO;
  const costKeys = new Set<string>();
  for (let d = addDays(x.cutOff, 1); d <= last; d = addDays(d, 1)) {
    const os = x.orders.filter((o) => o.delivery_date === d);
    if (os.length) {
      poDays.add(d);
      let rev = ZERO, kg = ZERO;
      for (const o of os) {
        const seg = o.segment === "Umum" ? "LB main" : o.segment;
        rows.push({ date: d, segment: seg, pl_line: o.revenue_line, basis: "po", actual: null, forecast: D(o.revenue), kg: D(o.kg), anomaly: false });
        rows.push({ date: d, segment: seg, pl_line: o.cogs_line, basis: "po", actual: null, forecast: D(o.cost).neg(), kg: null, anomaly: false });
        rev = rev.plus(D(o.revenue)); kg = kg.plus(D(o.kg));
        if (!o.costKnown) costKeys.add(`${o.segment}|${o.revenue_line}`);
      }
      kgByDay.set(d, kg);
      days.push({ date: d, kind: "po", revenue: rev, kg });
      poRevenue = poRevenue.plus(rev);
    } else {
      const working = x.isWorkingDay(d) && !(x.holidays ?? []).includes(d);
      const f = working ? D(1) : runrate.offDayFactor;
      if (f.gt(0) && runrate.revenue.gt(0)) {
        let dayRev = ZERO;
        for (const seg of SEGMENTS3) {
          const rev = runrate.bySegment[seg].times(f);
          if (rev.isZero()) continue;
          const gp = rev.times(margin);
          rows.push({ date: d, segment: seg, pl_line: REVENUE_LINE[seg], basis: "runrate", actual: null, forecast: rev, kg: null, anomaly: false });
          rows.push({ date: d, segment: seg, pl_line: COGS_LINE[seg], basis: "runrate", actual: null, forecast: gp.minus(rev), kg: null, anomaly: false });
          dayRev = dayRev.plus(rev);
        }
        days.push({ date: d, kind: "runrate", revenue: dayRev, kg: null });
        rrRevenue = rrRevenue.plus(dayRev);
      } else days.push({ date: d, kind: "none", revenue: ZERO, kg: null });
    }
  }
  const marginDays = new Set(days.filter((d) => d.kind === "runrate").map((d) => d.date));
  rows.push(...opexRowsV4({ month: x.month, cutOff: x.cutOff, isWorkingDay: x.isWorkingDay, holidays: x.holidays, input: x.opex, kgByDay, marginDays }));
  return {
    rows: rows.sort((a, b) => a.date.localeCompare(b.date) || a.segment.localeCompare(b.segment) || a.pl_line.localeCompare(b.pl_line) || a.basis.localeCompare(b.basis)),
    runrate, margin, days, poRevenue, runrateRevenue: rrRevenue, costMissingKeys: costKeys.size,
  };
}

// ------------------------------------------------------------------------------------------------ P7, P9 outlook and budget

export interface MonthSummaryV4 {
  actual: PlTotalsV4;
  forecast: PlTotalsV4;
  outlook: PlTotalsV4;
  /** Revenue forecast shares: PO, run-rate. null without forecast revenue. */
  poShare: Decimal | null;
  runrateShare: Decimal | null;
  poKg: Decimal;
  range: { revenueLow: Decimal; revenueHigh: Decimal; gpLow: Decimal; gpHigh: Decimal };
  lastActual: ISODate | null;
  remainingDays: number;
  remainingWorkingDays: number;
  bySegment: { segment: PlSegment; revenue: Decimal; gp: Decimal }[];
}

/** Everything the page shows from the month's rows (P5, P7): actual to the cut-off + forecast, range on the forecast part only. */
export function monthSummaryV4(rows: PlRowV4[], month: ISODate, tolerance: Num, isWorkingDay: (d: ISODate) => boolean = (d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0, mode: CostingRowsMode = "cogs"): MonthSummaryV4 {
  const actual = totalsV4(rows, "actual", undefined, mode), forecast = totalsV4(rows, "forecast", undefined, mode);
  const outlook = addT(actual, forecast);
  const tol = D(tolerance);
  const fRev = rows.filter((r) => r.forecast !== null && isRevenueLine(r.pl_line));
  const po = sum(fRev.filter((r) => r.basis === "po").map((r) => r.forecast!));
  const rr = sum(fRev.filter((r) => r.basis === "runrate").map((r) => r.forecast!));
  const actualDates = rows.filter((r) => r.actual !== null).map((r) => r.date).sort();
  const lastActual = actualDates.length ? actualDates[actualDates.length - 1] : null;
  const end = monthEnd(month);
  const remaining: ISODate[] = [];
  for (let d = lastActual ? addDays(lastActual, 1) : firstOfMonth(month); d <= end; d = addDays(d, 1)) remaining.push(d);
  const segs: PlSegment[] = ["LB main", "LB by-product", "Trading", "Umum"];
  return {
    actual, forecast, outlook,
    poShare: forecast.revenue.isZero() ? null : div(po, forecast.revenue), runrateShare: forecast.revenue.isZero() ? null : div(rr, forecast.revenue),
    poKg: sum(fRev.filter((r) => r.basis === "po").map((r) => r.kg ?? ZERO)),
    range: {
      revenueLow: outlook.revenue.minus(forecast.revenue.abs().times(tol)), revenueHigh: outlook.revenue.plus(forecast.revenue.abs().times(tol)),
      gpLow: outlook.gp.minus(forecast.gp.abs().times(tol)), gpHigh: outlook.gp.plus(forecast.gp.abs().times(tol)),
    },
    lastActual, remainingDays: remaining.length, remainingWorkingDays: remaining.filter((d) => isWorkingDay(d)).length,
    bySegment: segs.map((segment) => {
      const t = addT(totalsV4(rows.filter((r) => r.segment === segment), "actual", undefined, mode), totalsV4(rows.filter((r) => r.segment === segment), "forecast", undefined, mode));
      return { segment, revenue: t.revenue, gp: t.gp };
    }),
  };
}

export type BudgetMetric = "kg" | "revenue" | "gp" | "opex" | "nibt";
export interface BudgetRow { segment: string; metric: BudgetMetric; value: Num }

export interface VsBudgetLine {
  metric: BudgetMetric;
  budget: Decimal;
  outlook: Decimal;
  /** outlook − budget and as a share of the budget (null when the budget is 0). */
  diff: Decimal;
  diffPct: Decimal | null;
  /** (budget − actual MTD) / remaining working days (P9); null without remaining days. */
  needPerDay: Decimal | null;
}

export interface VsBudget {
  lines: VsBudgetLine[];
  /** Volume / price / margin split of the revenue and GP difference, when the budget carries kg (P9). */
  split: { revenueVolume: Decimal; revenuePrice: Decimal; gpVolume: Decimal; gpMargin: Decimal } | null;
}

/** P9: selisih = outlook − budget (Rp dan %), butuh per hari, and the volume / harga / margin split. Null budget = "belum diisi". */
export function vsBudget(x: { outlook: PlTotalsV4 & { kg?: Num | null }; actual: PlTotalsV4 & { kg?: Num | null }; budget: BudgetRow[]; remainingWorkingDays: number }): VsBudget | null {
  if (!x.budget.length) return null;
  const tot = (m: BudgetMetric) => { const r = x.budget.filter((b) => b.metric === m); return r.length ? sum(r.map((b) => D(b.value))) : null; };
  const pick: Record<BudgetMetric, { o: Decimal | null; a: Decimal | null }> = {
    kg: { o: x.outlook.kg === null || x.outlook.kg === undefined ? null : D(x.outlook.kg), a: x.actual.kg === null || x.actual.kg === undefined ? null : D(x.actual.kg) },
    revenue: { o: x.outlook.revenue, a: x.actual.revenue }, gp: { o: x.outlook.gp, a: x.actual.gp }, opex: { o: x.outlook.opex, a: x.actual.opex }, nibt: { o: x.outlook.nibt, a: x.actual.nibt },
  };
  const lines: VsBudgetLine[] = [];
  for (const m of ["kg", "revenue", "gp", "opex", "nibt"] as BudgetMetric[]) {
    const b = tot(m), p = pick[m];
    if (b === null || p.o === null || p.a === null) continue;
    // opex is carried negative in the rows; a budget is entered as a positive cost
    const budget = m === "opex" ? b.neg() : b;
    lines.push({ metric: m, budget, outlook: p.o, diff: p.o.minus(budget), diffPct: budget.isZero() ? null : div(p.o.minus(budget), budget.abs()), needPerDay: x.remainingWorkingDays > 0 ? budget.minus(p.a).div(x.remainingWorkingDays) : null });
  }
  const bKg = tot("kg"), bRev = tot("revenue"), bGp = tot("gp");
  const oKg = pick.kg.o;
  let split: VsBudget["split"] = null;
  if (bKg && !bKg.isZero() && oKg && !oKg.isZero() && bRev && bGp) {
    const pB = bRev.div(bKg), pO = x.outlook.revenue.div(oKg), mB = bGp.div(bKg), mO = x.outlook.gp.div(oKg);
    split = { revenueVolume: oKg.minus(bKg).times(pB), revenuePrice: pO.minus(pB).times(oKg), gpVolume: oKg.minus(bKg).times(mB), gpMargin: mO.minus(mB).times(oKg) };
  }
  return { lines, split };
}

// ------------------------------------------------------------------------------------------------ P8, P10, P11 register and lock

export interface RegisterRow {
  code: string;
  name: string;
  value_num: Num | null;
  value_text: string | null;
  basis: string | null;
  owner: string | null;
  agreed_at: string | null;
  deviation_note: string | null;
  status: "proposed" | "agreed" | "superseded";
}

/** The assumptions the engine itself makes for a month (P10), each with the owner the PRD names; none starts "agreed". */
export function engineAssumptions(x: {
  month: ISODate; cutOff: ISODate; plan: MonthPlanV4; tolerance: Num; windowDays: number; lockWeek: number;
}): RegisterRow[] {
  const mk = (code: string, name: string, owner: string, basis: string, num: Num | null, text: string | null, note: string | null = null): RegisterRow => ({
    code, name, value_num: num, value_text: text, basis, owner, agreed_at: null, deviation_note: note, status: "proposed",
  });
  const rows: RegisterRow[] = [
    mk("cut_off", "Cut-off aktual", "Finance", "upload jurnal harian terakhir yang lolos validasi", null, x.cutOff),
    mk("runrate_revenue", `Run-rate revenue per hari kerja (${x.windowDays} hari kalender terakhir, tanpa hari anomali)`, "Group Project Finance", "K3: rata-rata revenue hari kerja dalam jendela, jurnal", x.plan.runrate.revenue.toFixed(2), null),
    mk("runrate_offday", "Faktor Minggu / libur terhadap run-rate", "Group Project Finance", "pola actual jendela (Agustus: 0)", x.plan.runrate.offDayFactor.toFixed(6), null),
    mk("margin_ref", "Margin acuan hari run-rate", "Finance", "GP P&L ÷ revenue bulan berjalan (K5, P6)", x.plan.margin.toFixed(6), null),
    mk("tolerance", "Toleransi forecast (hanya porsi forecast)", "Group Project Finance", "K9, parameter forecast_tolerance_pct", D(x.tolerance).toFixed(6), null),
    mk("v1_lock", `Kunci V1: Kamis minggu ke-${x.lockWeek}`, "Group Project Finance", "K9, parameter v1_lock_week", null, v1LockDate(x.month, x.lockWeek)),
    mk("po_volume", "Volume PO sisa bulan (Confirmed 100%; Tentative dan Forecast tidak masuk)", "Sales", "P2, sales_line Order", x.plan.days.reduce((a, d) => a.plus(d.kg ?? ZERO), ZERO).toFixed(2), null),
  ];
  for (const a of x.plan.runrate.anomalies) {
    rows.push(mk(`anomaly_${a.date}`, `${a.date}: revenue ${a.reason === "nol" ? "0 pada hari kerja" : "di atas 3σ"} dibuang dari run-rate`, "Finance + Sales",
      "K12: data hilang atau anomali, bukan nol sah, sampai dipastikan", null, a.date, a.reason === "nol" ? "tidak ada baris penjualan maupun jurnal" : null));
  }
  return rows;
}

/** P10: a row without owner or agreement date is "belum disepakati" and blocks locking a version. */
export function registerOpen(rows: RegisterRow[]): RegisterRow[] {
  return rows.filter((r) => r.status !== "superseded" && (r.status !== "agreed" || !r.owner || !r.agreed_at));
}

export interface RunrateTest { segment: string; forecast: Decimal; meanActual: Decimal; deviation: Decimal | null; outside: boolean; reasoned: boolean }

/** P8: forecast working day ÷ mean actual working day of the window − 1, per segment; outside the tolerance a reason is required. */
export function runrateTest(x: { plan: MonthPlanV4; tolerance: Num; reasons: string[] }): RunrateTest[] {
  const rr = x.plan.runrate;
  const reasoned = rr.anomalies.length > 0 && rr.anomalies.every((a) => x.reasons.includes(a.date)) || x.reasons.includes("runrate");
  const total = (v: Decimal, mean: Decimal): RunrateTest => {
    const dev = mean.isZero() ? null : v.div(mean).minus(1);
    const outside = dev !== null && dev.abs().gt(D(x.tolerance));
    return { segment: "Total", forecast: v, meanActual: mean, deviation: dev, outside, reasoned: !outside || reasoned };
  };
  return [total(rr.revenue, rr.meanActualWindow)];
}

export interface LockBlocker { code: string; text: string }

/**
 * P11 (K9): what stops V1 being locked now. Empty = it can be locked. Controls arrive already evaluated; the
 * register, the run-rate test and the cost plan are checked here (P6, P8, P10).
 */
export function lockBlockers(x: {
  month: ISODate; today: ISODate; lockWeek: number;
  plan: MonthPlanV4; register: RegisterRow[]; test: RunrateTest[];
  controls: { code: string; status: string }[];
}): LockBlocker[] {
  const out: LockBlocker[] = [];
  const lock = v1LockDate(x.month, x.lockWeek);
  if (x.today < lock) out.push({ code: "K9", text: `V1 dikunci mulai Kamis minggu ke-${x.lockWeek} (${lock})` });
  for (const c of x.controls) if (["C33", "C34", "C49"].includes(c.code) && (c.status === "GAGAL" || c.status === "BELUM DIISI" || c.status === "STALE")) out.push({ code: c.code, text: `kontrol ${c.code} ${c.status}` });
  // v5 C55 (present only with v5_pl): V1 waits for the Finance schedule of fixed costs of the month
  for (const c of x.controls) if (c.code === "C55" && c.status === "PERIKSA") out.push({ code: "C55", text: "beban tetap memakai estimasi bulan lalu; isi jadwal beban tetap bulan ini" });
  if (x.plan.costMissingKeys > 0) out.push({ code: "P6", text: `cost rencana tidak tersedia untuk ${x.plan.costMissingKeys} baris PO` });
  for (const t of x.test) if (!t.reasoned) out.push({ code: "P8", text: `run-rate menyimpang ${t.deviation === null ? "" : `${t.deviation.times(100).toFixed(1)}%`} dari rata-rata actual; alasan wajib di register` });
  const open = registerOpen(x.register);
  if (open.length) out.push({ code: "P10", text: `${open.length} asumsi belum disepakati: ${open.slice(0, 3).map((r) => r.code).join(", ")}${open.length > 3 ? " …" : ""}` });
  return out;
}

// ------------------------------------------------------------------------------------------------ P12 bridge

export interface VersionDayV4 {
  date: ISODate;
  kind: "actual" | "po" | "runrate" | "none";
  revenue: Num;
  /** Negative (P&L sign). */
  cogs: Num;
  opex: Num;
  kg?: Num | null;
}

export interface BridgeMetric { from: Decimal; to: Decimal; dActual: Decimal; dVolume: Decimal; dPrice: Decimal; dCost: Decimal; dEvent: Decimal; residual: Decimal }
export interface BridgeV4 { revenue: BridgeMetric; gp: BridgeMetric; nibt: BridgeMetric }

/** Version days of the month from the rows (what a locked version stores as its snapshot). */
export function versionDaysV4(rows: PlRowV4[], month: ISODate, cutOff: ISODate, mode: CostingRowsMode = "cogs"): VersionDayV4[] {
  const end = monthEnd(month);
  const out: VersionDayV4[] = [];
  for (let d = firstOfMonth(month); d <= end; d = addDays(d, 1)) {
    const rs = rows.filter((r) => r.date === d);
    // every day up to the cut-off is actual, also one without a row (missing data: revenue counted as 0 in the version)
    const hasActual = d <= cutOff;
    const v = (r: PlRowV4) => (hasActual ? r.actual : r.forecast) ?? ZERO;
    const t = (p: (l: string) => boolean) => sum(rs.filter((r) => p(r.pl_line) && (hasActual ? r.actual !== null : r.forecast !== null)).map(v));
    const revRows = rs.filter((r) => isRevenueLine(r.pl_line) && r.forecast !== null);
    const kind: VersionDayV4["kind"] = hasActual ? "actual" : revRows.some((r) => r.basis === "po") ? "po" : revRows.some((r) => r.basis === "runrate") ? "runrate" : "none";
    out.push({
      date: d, kind, revenue: t(isRevenueLine).toFixed(2), cogs: t((l) => isCogsLine(l, mode)).toFixed(2), opex: t((l) => isOpexLine(l, mode)).toFixed(2),
      kg: kind === "po" ? sum(revRows.map((r) => r.kg ?? ZERO)).toFixed(2) : null,
    });
  }
  return out;
}

/**
 * V1 → V2 bridge (P12) for revenue, GP and NIBT: Δ actual (days that moved from forecast to actual), Δ volume
 * ((kg2 − kg1) × V1 price, at the V1 unit margin for GP), Δ harga ((p2 − p1) × kg2), Δ cost (−(c2 − c1) × kg2, and the
 * change in operating cost for NIBT), Δ event (PO added or lost, holiday, run-rate assumption). The residual is
 * outlook V2 − V1 minus every step; C32 wants it within Rp 1 for all three.
 */
export function bridgeV4(v1: VersionDayV4[], v2: VersionDayV4[]): BridgeV4 {
  const a = new Map(v1.map((d) => [d.date, d])), b = new Map(v2.map((d) => [d.date, d]));
  const blank = (): BridgeMetric => ({ from: ZERO, to: ZERO, dActual: ZERO, dVolume: ZERO, dPrice: ZERO, dCost: ZERO, dEvent: ZERO, residual: ZERO });
  const out: BridgeV4 = { revenue: blank(), gp: blank(), nibt: blank() };
  const num = (d: VersionDayV4 | undefined) => ({ rev: D(d?.revenue ?? 0), cogs: D(d?.cogs ?? 0), opex: D(d?.opex ?? 0) });
  for (const date of [...new Set([...a.keys(), ...b.keys()])]) {
    const x = a.get(date), y = b.get(date);
    const p = num(x), q = num(y);
    const m1 = { revenue: p.rev, gp: p.rev.plus(p.cogs), nibt: p.rev.plus(p.cogs).plus(p.opex) };
    const m2 = { revenue: q.rev, gp: q.rev.plus(q.cogs), nibt: q.rev.plus(q.cogs).plus(q.opex) };
    for (const k of ["revenue", "gp", "nibt"] as const) { out[k].from = out[k].from.plus(m1[k]); out[k].to = out[k].to.plus(m2[k]); }
    const diff = (k: "revenue" | "gp" | "nibt") => m2[k].minus(m1[k]);
    if ((x?.kind ?? "none") !== "actual" && y?.kind === "actual") { for (const k of ["revenue", "gp", "nibt"] as const) out[k].dActual = out[k].dActual.plus(diff(k)); continue; }
    if (x?.kind === "po" && y?.kind === "po" && x.kg && y.kg && !D(x.kg).isZero() && !D(y.kg).isZero()) {
      const k1 = D(x.kg), k2 = D(y.kg);
      const p1 = p.rev.div(k1), p2 = q.rev.div(k2), c1 = p.cogs.neg().div(k1), c2 = q.cogs.neg().div(k2);
      const volRev = k2.minus(k1).times(p1), price = p2.minus(p1).times(k2);
      const volCogs = k2.minus(k1).times(c1), costRate = c2.minus(c1).times(k2);
      out.revenue.dVolume = out.revenue.dVolume.plus(volRev); out.revenue.dPrice = out.revenue.dPrice.plus(price);
      out.gp.dVolume = out.gp.dVolume.plus(volRev.minus(volCogs)); out.gp.dPrice = out.gp.dPrice.plus(price); out.gp.dCost = out.gp.dCost.minus(costRate);
      const dOpex = q.opex.minus(p.opex);
      out.nibt.dVolume = out.nibt.dVolume.plus(volRev.minus(volCogs)); out.nibt.dPrice = out.nibt.dPrice.plus(price); out.nibt.dCost = out.nibt.dCost.minus(costRate).plus(dOpex);
      continue;
    }
    // PO added or lost, holiday, run-rate assumption changed: an event; the opex change of a day is a cost
    out.revenue.dEvent = out.revenue.dEvent.plus(diff("revenue"));
    out.gp.dEvent = out.gp.dEvent.plus(diff("gp"));
    const dOpex = q.opex.minus(p.opex);
    out.nibt.dEvent = out.nibt.dEvent.plus(diff("gp"));
    out.nibt.dCost = out.nibt.dCost.plus(dOpex);
  }
  for (const k of ["revenue", "gp", "nibt"] as const) {
    const m = out[k];
    m.residual = m.to.minus(m.from).minus(m.dActual).minus(m.dVolume).minus(m.dPrice).minus(m.dCost).minus(m.dEvent);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ P13 accuracy

export interface AccuracyLineV4 {
  version: string;
  metric: "revenue" | "gp" | "nibt";
  value: Decimal;
  /** null when the FINAL does not carry the metric (never 0). */
  final: Decimal | null;
  bias: Decimal | null;
  absError: Decimal | null;
  /** |error| / FINAL; null when FINAL is 0 ("N/A"). Only revenue gets a MAPE (P13); GP and NIBT keep abs error and bias. */
  mape: Decimal | null;
  /** (FINAL − version) / version, the "+8,4%" of the PRD example; null when the version is 0. */
  pctOfVersion: Decimal | null;
  /** |error| as a share of the version's forecast part (the "+49%"); null without forecast part. */
  shareOfForecast: Decimal | null;
  biasPre: Decimal | null;
  absErrorPre: Decimal | null;
}

/** P13: each version against FINAL, before and after the closing adjustments. */
export function accuracyV4(x: {
  final: Record<"revenue" | "gp" | "nibt", Num | null>;
  adjustments: Record<"revenue" | "gp" | "nibt", Num>;
  versions: { version: string; revenue: Num | null; gp: Num | null; nibt: Num | null; forecastPart?: Partial<Record<"revenue" | "gp" | "nibt", Num>> }[];
}): AccuracyLineV4[] {
  const out: AccuracyLineV4[] = [];
  for (const v of x.versions) for (const m of ["revenue", "gp", "nibt"] as const) {
    // R64: a metric the version did not carry is left out, never shown as 0
    const valRaw = v[m], finRaw = x.final[m];
    if (valRaw === null || valRaw === undefined || valRaw === "") continue;
    const val = D(valRaw);
    const fin = finRaw === null || finRaw === undefined || finRaw === "" ? null : D(finRaw);
    const pre = fin === null ? null : fin.minus(D(x.adjustments[m] ?? 0));
    const err = fin === null ? null : val.minus(fin);
    const fp = v.forecastPart?.[m];
    out.push({
      version: v.version, metric: m, value: val, final: fin, bias: err, absError: err === null ? null : err.abs(),
      mape: m === "revenue" && fin !== null && !fin.isZero() ? err!.abs().div(fin.abs()) : null,
      pctOfVersion: fin === null || val.isZero() ? null : fin.minus(val).div(val.abs()),
      shareOfForecast: fp === undefined || D(fp).isZero() || err === null ? null : err.abs().div(D(fp).abs()),
      biasPre: pre === null ? null : val.minus(pre), absErrorPre: pre === null ? null : val.minus(pre).abs(),
    });
  }
  return out;
}

export interface AccuracyDay { date: ISODate; segment: string; forecast: Decimal; actual: Decimal; diff: Decimal; day_kind: "po" | "runrate"; diff_kg: Decimal | null; diff_price: Decimal | null }

/**
 * Per day accuracy (forecast_accuracy_daily): a day that was forecast in the version, against what was booked. On PO
 * days the difference splits into kg shipped (at the forecast price) and price (on the kg shipped).
 */
export function accuracyDays(x: { version: VersionDayV4[]; actual: { date: ISODate; revenue: Num; kg?: Num | null }[] }): AccuracyDay[] {
  const act = new Map(x.actual.map((d) => [d.date, d]));
  const out: AccuracyDay[] = [];
  for (const f of x.version) {
    if ((f.kind !== "po" && f.kind !== "runrate")) continue;
    const a = act.get(f.date);
    const fr = D(f.revenue), ar = D(a?.revenue ?? 0);
    let dk: Decimal | null = null, dp: Decimal | null = null;
    if (f.kind === "po" && f.kg && !D(f.kg).isZero() && a?.kg !== undefined && a.kg !== null) {
      const p1 = fr.div(D(f.kg)), k2 = D(a.kg);
      dk = k2.minus(D(f.kg)).times(p1);
      dp = ar.minus(fr).minus(dk);
    }
    out.push({ date: f.date, segment: "Total", forecast: fr, actual: ar, diff: ar.minus(fr), day_kind: f.kind, diff_kg: dk, diff_price: dp });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ controls (C49, C32 on three metrics)

/** C49: Σ pl_daily actual (journal) from the 1st to the cut-off = the P&L of the month to date (± Rp 1). */
export function c49(x: { rows: PlRowV4[]; pnlMtd: { revenue: Num; cogs: Num; gp: Num } | null }): ControlV3 {
  const j = totalsV4(x.rows, "actual", (b) => b === "journal");
  if (x.pnlMtd === null) return {
    code: "C49", module: "M4", name: "Σ pl_daily actual = P&L bulan berjalan (± Rp 1)", value: j.gp, comparator: null, difference: null, status: "BELUM DIISI",
    action: "Laba Rugi bulan berjalan belum tersedia", detail: [],
  };
  const diffs = [["revenue", j.revenue.minus(D(x.pnlMtd.revenue))], ["COGS", j.cogs.minus(D(x.pnlMtd.cogs))], ["GP", j.gp.minus(D(x.pnlMtd.gp))]] as const;
  const worst = diffs.reduce((m, [, d]) => (d.abs().gt(m) ? d.abs() : m), ZERO);
  return {
    code: "C49", module: "M4", name: "Σ pl_daily actual = P&L bulan berjalan (± Rp 1)", value: j.gp, comparator: D(x.pnlMtd.gp), difference: j.gp.minus(D(x.pnlMtd.gp)),
    status: worst.gt(1) ? "GAGAL" : "LULUS", action: worst.gt(1) ? "Bangun ulang pl_daily atau periksa jurnal yang belum terbaca" : "",
    detail: worst.gt(1) ? diffs.filter(([, d]) => d.abs().gt(1)).map(([k, d]) => `${k}: selisih ${d.toFixed(2)}`) : [],
  };
}

/** C32 on the three metrics of the V1 → V2 bridge (revenue, GP, NIBT; Rp 1). */
export function c32(b: BridgeV4 | null): ControlV3 {
  const worst = b ? max(b.revenue.residual.abs(), max(b.gp.residual.abs(), b.nibt.residual.abs())) : null;
  return {
    code: "C32", module: "M4", name: "Bridge V1 → V2 menutup (revenue, GP, NIBT; ± Rp 1)", value: worst ?? ZERO, comparator: ZERO, difference: worst,
    status: worst === null ? "BELUM DIISI" : worst.gt(1) ? "GAGAL" : "LULUS",
    action: worst !== null && worst.gt(1) ? "Periksa hari yang hilang dari salah satu versi" : "", detail: b === null ? ["V1 dan V2 belum dikunci"] : [],
  };
}

// ------------------------------------------------------------------------------------------------ adapters

/** PO lines of a computed week → forecast orders with their segment (P2) and whether the SKU has a cost per kg (P6). */
export function ordersV4FromWeek(
  sales: { status: string; date: ISODate | null; kg: Decimal; value: Decimal; hpp: Decimal; segment: string; group: string; src: { id?: string } }[],
  from: ISODate, to: ISODate, weight: (id: string | undefined) => Num,
): OrderV4[] {
  return sales.filter((s) => s.status === "Order" && s.date !== null && s.date >= from && s.date <= to && D(weight(s.src.id)).gt(0)).map((s) => {
    const w = D(weight(s.src.id));
    const revenue_line = s.segment === "Trading" ? "Revenue - Trading" : s.group === "By-product" ? "Revenue - LB By Product" : "Revenue - LB Main Product";
    const cogs_line = s.segment === "Trading" ? "COGS - Trading" : "COGS - Live Bird";
    return {
      delivery_date: s.date!, kg: s.kg.times(w), revenue: s.value.times(w), cost: s.hpp.times(w), revenue_line, cogs_line,
      segment: segmentOfLine(revenue_line), costKnown: s.hpp.gt(0) || s.kg.isZero(),
    };
  });
}

const NOT_RUNRATE = new Set(["COGS - Live Bird", "COGS - Trading"]);

/**
 * Journal cost per line this month for the run-rate lines (everything except revenue and the two product COGS lines,
 * which the PO rows and the reference margin cover): positive = cost, Other Income positive = income, one-off cost
 * events taken out (K6).
 */
export function runrateActualLines(x: {
  gl: { date: ISODate | null; account: string | null; debit: Num | null; credit: Num | null }[];
  coa: { account: string; pl_line: string | null }[];
  from: ISODate; to: ISODate;
  events: { date: ISODate; pl_line: string; amount: Num }[];
}): { pl_line: string; actual_mtd: Decimal }[] {
  const lineOf = new Map(x.coa.filter((c) => c.pl_line).map((c) => [c.account, c.pl_line as string]));
  const by: Record<string, Decimal> = {};
  for (const g of x.gl) {
    if (!g.date || g.date < x.from || g.date > x.to || !g.account) continue;
    const l = lineOf.get(g.account);
    if (!l || isRevenueLine(l) || NOT_RUNRATE.has(l)) continue;
    by[l] = (by[l] ?? ZERO).plus(D(g.debit ?? 0)).minus(D(g.credit ?? 0));
  }
  // events are negative amounts (cost); the actual here is positive = cost, so adding takes the event out
  for (const e of x.events) if (e.date >= x.from && e.date <= x.to && by[e.pl_line] !== undefined) by[e.pl_line] = by[e.pl_line].plus(D(e.amount));
  return Object.entries(by).map(([pl_line, v]) => ({ pl_line, actual_mtd: pl_line === "Other Income" ? v.neg() : v }));
}
