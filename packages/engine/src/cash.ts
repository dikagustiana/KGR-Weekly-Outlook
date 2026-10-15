/**
 * M6 — cash position, 13-week / 12-month projection, solvency (PRD v3 §4.7). Pure functions, decimal.js.
 *
 * Position per day = Σ over bank accounts of the latest closing balance ≤ the day (template kas harian). Projection =
 * that closing + planned movements (cash_daily_plan status plan, and fixed-cost schedule payments not planned yet)
 * per day → per week (13) → lowest closing. 12 months = this month's outlook cash (NIBT + non-cash D&A) then the
 * same monthly cash change held flat. Solvency: equity of the last weekly balance sheet and months to negative equity
 * = equity / −NIBT outlook when NIBT < 0.
 */
import { D, Decimal, ZERO, div, sum, type Num } from "./decimal";
import { addDays, daysInMonth, diffDays, firstOfMonth, type ISODate } from "./dates";
import type { ControlV3 } from "./controls-v3";
import { monthlyAmount, type FixedCostRow } from "./drivers";

export interface CashBalance {
  date: ISODate;
  account_no: string;
  opening: Num | null;
  closing: Num;
}

export interface CashPlan {
  date: ISODate;
  account_no?: string | null;
  cf_category?: string | null;
  description?: string | null;
  /** + in / − out */
  amount: Num;
  status?: "plan" | "done" | "cancelled" | string | null;
  fixed_cost_schedule_id?: string | null;
}

/** Closing balance per account on a day: its row that day, else its latest row before (carried). */
export function balancesOn(rows: CashBalance[], date: ISODate): { account_no: string; date: ISODate; closing: Decimal; carried: boolean }[] {
  const latest = new Map<string, CashBalance>();
  for (const r of rows) {
    if (r.date > date) continue;
    const p = latest.get(r.account_no);
    if (!p || r.date > p.date) latest.set(r.account_no, r);
  }
  return [...latest.values()].sort((a, b) => a.account_no.localeCompare(b.account_no))
    .map((r) => ({ account_no: r.account_no, date: r.date, closing: D(r.closing), carried: r.date !== date }));
}

/** Fixed-cost schedule payments (cash_day_of_month) in [from, to] that no plan row already covers. */
export function scheduledPayments(schedule: FixedCostRow[], plans: CashPlan[], cashDay: Record<string, number | null>, from: ISODate, to: ISODate): CashPlan[] {
  const planned = new Set(plans.filter((p) => p.fixed_cost_schedule_id).map((p) => `${p.fixed_cost_schedule_id}|${p.date.slice(0, 7)}`));
  const out: CashPlan[] = [];
  for (let m = firstOfMonth(from); m <= to; m = addDays(m, daysInMonth(m))) {
    for (const r of schedule) {
      const day = cashDay[r.id];
      if (!day || !r.active || r.amortize) continue; // a prepaid was paid up front; its amortisation is not cash
      const d = addDays(m, Math.min(day, daysInMonth(m)) - 1);
      if (d < from || d > to || d < r.start_date || (r.end_date !== null && d > r.end_date) || planned.has(`${r.id}|${d.slice(0, 7)}`)) continue;
      const a = monthlyAmount(r);
      if (a === null) continue;
      out.push({ date: d, description: `${r.description} (jadwal)`, amount: a.neg(), status: "plan", fixed_cost_schedule_id: r.id });
    }
  }
  return out;
}

export interface CashPositionDay {
  date: ISODate;
  total_closing: Decimal;
  total_plan_in: Decimal;
  total_plan_out: Decimal;
  projected_closing: Decimal;
}

export interface CashWeek {
  week_start: ISODate;
  opening: Decimal;
  cash_in: Decimal;
  cash_out: Decimal;
  closing: Decimal;
  lowest_day: ISODate;
  lowest: Decimal;
}

/**
 * Projection from a start day: actual closing of the start day, then the planned movements of every later day.
 * Returns the days and 13 weeks (Monday-start from the start day's week), with the lowest closing of the horizon.
 */
export function cashProjection(x: { start: ISODate; balances: CashBalance[]; plans: CashPlan[]; weeks?: number }): { days: CashPositionDay[]; weeks: CashWeek[]; lowest: Decimal; lowestDate: ISODate; startClosing: Decimal } {
  const n = x.weeks ?? 13;
  const startClosing = sum(balancesOn(x.balances, x.start).map((b) => b.closing));
  const live = x.plans.filter((p) => (p.status ?? "plan") === "plan");
  const dow = new Date(`${x.start}T00:00:00Z`).getUTCDay();
  const monday = addDays(x.start, -((dow + 6) % 7));
  const end = addDays(monday, n * 7 - 1);
  const days: CashPositionDay[] = [];
  let bal = startClosing;
  for (let d = x.start; d <= end; d = addDays(d, 1)) {
    const today = d === x.start ? [] : live.filter((p) => p.date === d);
    const pin = sum(today.filter((p) => D(p.amount).gt(0)).map((p) => D(p.amount)));
    const pout = sum(today.filter((p) => D(p.amount).lt(0)).map((p) => D(p.amount)));
    bal = bal.plus(pin).plus(pout);
    days.push({ date: d, total_closing: d === x.start ? startClosing : ZERO, total_plan_in: pin, total_plan_out: pout, projected_closing: bal });
  }
  const weeks: CashWeek[] = [];
  let opening = startClosing;
  for (let i = 0; i < n; i++) {
    const ws = addDays(monday, i * 7), we = addDays(ws, 6);
    const ds = days.filter((d) => d.date >= ws && d.date <= we);
    if (!ds.length) continue;
    const low = ds.reduce((a, b) => (b.projected_closing.lt(a.projected_closing) ? b : a));
    const w: CashWeek = {
      week_start: ws, opening, cash_in: sum(ds.map((d) => d.total_plan_in)), cash_out: sum(ds.map((d) => d.total_plan_out)),
      closing: ds[ds.length - 1].projected_closing, lowest_day: low.date, lowest: low.projected_closing,
    };
    weeks.push(w);
    opening = w.closing;
  }
  const lowDay = days.reduce((a, b) => (b.projected_closing.lt(a.projected_closing) ? b : a), days[0]);
  return { days, weeks, lowest: lowDay.projected_closing, lowestDate: lowDay.date, startClosing };
}

/** 12 months: this month's outlook cash change (NIBT + D&A, non-cash), then held flat; cumulative closing per month. */
export function cashProjection12m(x: { month: ISODate; startClosing: Num; nibtOutlook: Num; depreciation: Num; months?: number }): { month: ISODate; change: Decimal; closing: Decimal }[] {
  const n = x.months ?? 12;
  const change = D(x.nibtOutlook).plus(D(x.depreciation).abs());
  const out: { month: ISODate; change: Decimal; closing: Decimal }[] = [];
  let c = D(x.startClosing), m = firstOfMonth(x.month);
  for (let i = 0; i < n; i++) {
    c = c.plus(change);
    out.push({ month: m, change, closing: c });
    m = addDays(m, daysInMonth(m));
  }
  return out;
}

export interface Solvency {
  equity: Decimal;
  paid_in_capital: Decimal;
  affiliate_payable: Decimal;
  affiliate_receivable: Decimal;
  /** Equity left of the paid-in capital. */
  equity_to_capital: Decimal;
  /** Equity / −NIBT per month when NIBT < 0, else null. */
  months_to_negative_equity: Decimal | null;
  basis_nibt: Decimal | null;
}

export function solvency(x: { equity: Num; paidInCapital: Num; affiliatePayable: Num; affiliateReceivable: Num; nibtMonth: Num | null }): Solvency {
  const eq = D(x.equity);
  const nibt = x.nibtMonth === null || x.nibtMonth === undefined || x.nibtMonth === "" ? null : D(x.nibtMonth);
  return {
    equity: eq, paid_in_capital: D(x.paidInCapital), affiliate_payable: D(x.affiliatePayable), affiliate_receivable: D(x.affiliateReceivable),
    equity_to_capital: div(eq, D(x.paidInCapital)),
    months_to_negative_equity: nibt !== null && nibt.lt(0) ? eq.div(nibt.neg()) : null, basis_nibt: nibt,
  };
}

/**
 * C35: Σ closing of every bank account = cash on the balance sheet (± Rp 1).
 * C36: working days (Mon–Sat) up to yesterday without a cash upload (BELUM DIISI).
 * C37: payables with a debit (negative) balance in the projection (D4) — PERIKSA.
 */
export function cashControls(x: {
  date: ISODate;
  balances: CashBalance[];
  bsCash: Num | null;
  from: ISODate;
  isWorkingDay: (d: ISODate) => boolean;
  payables: { line: string; value: Num }[];
}): ControlV3[] {
  const on = balancesOn(x.balances, x.date);
  const total = sum(on.map((b) => b.closing));
  const diff = x.bsCash === null ? null : total.minus(D(x.bsCash));
  const have = new Set(x.balances.map((b) => b.date));
  const missing: ISODate[] = [];
  for (let d = x.from; d <= x.date; d = addDays(d, 1)) if (x.isWorkingDay(d) && !have.has(d)) missing.push(d);
  const neg = x.payables.filter((p) => D(p.value).lt(0));
  const n = (v: number) => D(v);
  return [
    {
      code: "C35", module: "M6", name: "Σ saldo rekening = kas neraca", value: total, comparator: x.bsCash === null ? null : D(x.bsCash), difference: diff,
      status: !on.length || diff === null ? "BELUM DIISI" : diff.abs().gt(1) ? "GAGAL" : "LULUS",
      action: diff !== null && diff.abs().gt(1) ? "Cocokkan saldo rekening dengan jurnal kas (Accurate)" : "",
      detail: on.map((b) => `${b.account_no}: ${b.closing.toFixed(2)}${b.carried ? ` (saldo ${b.date})` : ""}`),
    },
    {
      code: "C36", module: "M6", name: "Hari kerja tanpa upload kas", value: n(missing.length), comparator: n(0), difference: n(missing.length),
      status: missing.length ? "BELUM DIISI" : "LULUS", action: missing.length ? "Upload template kas harian untuk tanggal berikut" : "", detail: missing,
    },
    {
      code: "C37", module: "M6", name: "Utang bersaldo debit di proyeksi (D4)", value: n(neg.length), comparator: n(0), difference: neg.reduce((m, p) => m.plus(D(p.value)), ZERO),
      status: neg.length ? "PERIKSA" : "LULUS", action: neg.length ? "Reklas uang muka pemasok / pos lawan rencana kas" : "",
      detail: neg.map((p) => `${p.line}: ${D(p.value).toFixed(0)}`),
    },
  ];
}

/** Days between two dates, exposed for pages that label the horizon. */
export const horizonDays = (a: ISODate, b: ISODate) => diffDays(b, a) + 1;

// ------------------------------------------------------------------------------------------------ PRD v4 §3.7: operations vs affiliate funding

export const AFFILIATE_CATEGORY = "Pinjaman afiliasi (net)";
export const isAffiliatePlan = (p: CashPlan) => (p.cf_category ?? "").trim() === AFFILIATE_CATEGORY;

export interface CashSplitWeek {
  week_start: ISODate;
  closing: Decimal;
  /** Closing without any affiliate funding (the scenario "tanpa fasilitas afiliasi"). */
  closingWithout: Decimal;
  operatingIn: Decimal;
  operatingOut: Decimal;
  affiliateNet: Decimal;
}

export interface CashSplit {
  days: { date: ISODate; closing: Decimal; closingWithout: Decimal }[];
  weeks: CashSplitWeek[];
  lowest: { date: ISODate; balance: Decimal };
  lowestWithout: { date: ISODate; balance: Decimal };
  /** The biggest outflows of the day of the lowest balance without the facility: what pushes the deficit (journey H). */
  drivers: { description: string; amount: Decimal }[];
  /** Always true: the scenario rests on the affiliate amount the caller says was already received (status assumption). */
  assumption: string;
}

/**
 * Operations and affiliate funding apart (G6): the closing per day with the planned affiliate flows, and the same series
 * without them minus `affiliateReceived` — the affiliate funding already inside the start balance (the user-given
 * assumption; 0 when unknown). Lowest balance of each series, and the outflows of the lowest day without the facility.
 */
export function cashProjectionSplit(x: { start: ISODate; balances: CashBalance[]; plans: CashPlan[]; weeks?: number; affiliateReceived?: Num }): CashSplit {
  const base = cashProjection({ start: x.start, balances: x.balances, plans: x.plans, weeks: x.weeks });
  const live = x.plans.filter((p) => (p.status ?? "plan") === "plan");
  const recv = D(x.affiliateReceived ?? 0);
  let aff = ZERO;
  const days = base.days.map((d) => {
    if (d.date !== x.start) aff = aff.plus(sum(live.filter((p) => p.date === d.date && isAffiliatePlan(p)).map((p) => D(p.amount))));
    return { date: d.date, closing: d.projected_closing, closingWithout: d.projected_closing.minus(aff).minus(recv) };
  });
  const dow = new Date(`${x.start}T00:00:00Z`).getUTCDay();
  const monday = addDays(x.start, -((dow + 6) % 7));
  const weeks: CashSplitWeek[] = base.weeks.map((w) => {
    const ws = w.week_start, we = addDays(ws, 6);
    const ps = live.filter((p) => p.date > x.start && p.date >= ws && p.date <= we);
    const ds = days.filter((d) => d.date >= ws && d.date <= we);
    const aff2 = sum(ps.filter(isAffiliatePlan).map((p) => D(p.amount)));
    return {
      week_start: ws, closing: w.closing, closingWithout: ds.length ? ds[ds.length - 1].closingWithout : w.closing.minus(recv),
      operatingIn: sum(ps.filter((p) => !isAffiliatePlan(p) && D(p.amount).gt(0)).map((p) => D(p.amount))),
      operatingOut: sum(ps.filter((p) => !isAffiliatePlan(p) && D(p.amount).lt(0)).map((p) => D(p.amount))),
      affiliateNet: aff2,
    };
  });
  void monday;
  const lo = (f: (d: (typeof days)[number]) => Decimal) => days.reduce((a, b) => (f(b).lt(f(a)) ? b : a), days[0]);
  const l1 = lo((d) => d.closing), l2 = lo((d) => d.closingWithout);
  const drivers = live.filter((p) => p.date === l2.date && !isAffiliatePlan(p) && D(p.amount).lt(0))
    .map((p) => ({ description: p.description ?? p.cf_category ?? "pembayaran", amount: D(p.amount) })).sort((a, b) => a.amount.cmp(b.amount)).slice(0, 5);
  return {
    days, weeks, lowest: { date: l1.date, balance: l1.closing }, lowestWithout: { date: l2.date, balance: l2.closingWithout }, drivers,
    assumption: recv.isZero() ? "tanpa fasilitas afiliasi: hanya arus afiliasi yang direncanakan dikeluarkan" : `tanpa fasilitas afiliasi: arus afiliasi terencana dan ${recv.div(1e6).toFixed(1)} jt yang sudah diterima dikeluarkan`,
  };
}

/** 12 months: "tidak tersedia" (null) without a monthly outlook as its basis, never zeros (§3.7). */
export function cashProjection12mOrNull(x: { month: ISODate; startClosing: Num | null; nibtOutlook: Num | null; depreciation: Num | null; months?: number }): ReturnType<typeof cashProjection12m> | null {
  if (x.startClosing === null || x.nibtOutlook === null) return null;
  return cashProjection12m({ month: x.month, startClosing: x.startClosing, nibtOutlook: x.nibtOutlook, depreciation: x.depreciation ?? 0, months: x.months });
}

/** Weeks (Monday–Sunday) from the days of the cash mart: closing of the last day, operating in / out and affiliate net summed. */
export function cashWeeksFromDays(days: { date: ISODate; closing: Num | null; closing_without: Num | null; operating_in: Num | null; operating_out: Num | null; affiliate_net: Num | null }[]): CashSplitWeek[] {
  const by = new Map<ISODate, typeof days>();
  for (const d of days.slice().sort((a, b) => a.date.localeCompare(b.date))) {
    const dow = new Date(`${d.date}T00:00:00Z`).getUTCDay();
    const ws = addDays(d.date, -((dow + 6) % 7));
    by.set(ws, [...(by.get(ws) ?? []), d]);
  }
  return [...by.entries()].map(([week_start, ds]) => {
    const last = ds[ds.length - 1];
    return {
      week_start, closing: D(last.closing ?? 0), closingWithout: D(last.closing_without ?? last.closing ?? 0),
      operatingIn: sum(ds.map((d) => D(d.operating_in ?? 0))), operatingOut: sum(ds.map((d) => D(d.operating_out ?? 0))), affiliateNet: sum(ds.map((d) => D(d.affiliate_net ?? 0))),
    };
  });
}
