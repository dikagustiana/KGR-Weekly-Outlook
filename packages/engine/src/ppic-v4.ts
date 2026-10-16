/**
 * M3 v4 (PRD v4 §3.1 P3.1–P3.9, K1, K2, K8): what the PPIC page and the rebuild need beyond weekDemand / plan.ts —
 * the statistical forecast of a week (K2), the by-product shortfall rows (C41, demand_shortfall), the controls
 * C41 / C42 / C44 / C46 / C47, what blocks save / approve / copy, the step gates of the Rencana page, and actual vs plan
 * per production unit per day (P3.7, plan_variance_daily). Pure functions, decimal.js.
 */
import { D, Decimal, ZERO, max, sum, type Num } from "./decimal";
import { addDays, diffDays, type ISODate } from "./dates";
import type { ControlV3, ControlV3Status } from "./controls-v3";
import { demandRate, type ForecastLine, type SalesHistoryRow, type WeekDemandResult } from "./demand";

const n = (v: number) => D(v);

// ------------------------------------------------------------------------------------------------ K2 statistical forecast

export interface StatForecast {
  lines: ForecastLine[];
  /** Working days of history per key (for C44). */
  historyDays: Map<string, number>;
  rates: { key: string; avgDaily: Decimal; days: number; stockoutDays: number }[];
}

/**
 * K2 / P3.2: demand rate per key = mean kg per Normal working day of the history (stockout days, when the free stock
 * of the key was 0, are left out — `demandRate`); the week's statistical kg = rate × working days of the week. It is
 * the demand beyond the PO lines: max(0, statistical − open PO kg of the key in that week), so a PO is not counted
 * twice (docs/v4/QUESTIONS.md). Keys with fewer than `minDays` working days of history get no line.
 */
export function statForecastWeek(x: {
  sales: { date: ISODate; key: string; kg: Num }[];
  from: ISODate;
  to: ISODate;
  isWorkingDay: (d: ISODate) => boolean;
  /** true when the key had no free stock that day (sku_balance_daily.free_kg = 0). */
  stockout: (key: string, date: ISODate) => boolean;
  weekStart: ISODate;
  poKg: Map<string, Decimal>;
  minDays?: number;
}): StatForecast {
  const minDays = x.minDays ?? 20;
  const keys = [...new Set(x.sales.map((s) => s.key))].sort();
  const byKeyDay = new Map<string, Decimal>();
  for (const s of x.sales) if (s.date >= x.from && s.date <= x.to) byKeyDay.set(`${s.key}|${s.date}`, (byKeyDay.get(`${s.key}|${s.date}`) ?? ZERO).plus(D(s.kg)));
  const days: ISODate[] = [];
  for (let d = x.from; d <= x.to; d = addDays(d, 1)) if (x.isWorkingDay(d)) days.push(d);
  const history: SalesHistoryRow[] = [];
  for (const k of keys) for (const d of days) history.push({ date: d, sku: k, kg: (byKeyDay.get(`${k}|${d}`) ?? ZERO).toString(), flag: x.stockout(k, d) ? "Stockout" : "Normal" });
  const rates = demandRate(history, keys);
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(x.weekStart, i)).filter(x.isWorkingDay).length;
  const historyDays = new Map(keys.map((k) => [k, days.length]));
  const lines: ForecastLine[] = [];
  for (const r of rates) {
    if (days.length < minDays || r.avgDaily.isZero()) continue;
    const kg = max(ZERO, r.avgDaily.times(weekDays).minus(x.poKg.get(r.sku) ?? ZERO));
    if (kg.isZero()) continue;
    lines.push({ week_start: x.weekStart, key: r.sku, kg: kg.toFixed(2), source: "stat" });
  }
  return { lines, historyDays, rates: rates.map((r) => ({ key: r.sku, avgDaily: r.avgDaily, days: r.days, stockoutDays: r.stockoutDays })) };
}

// ------------------------------------------------------------------------------------------------ C41 shortfall rows

export interface ShortfallRow {
  week_start: ISODate;
  key: string;
  net_kg: Decimal;
  output_kg_at_plan: Decimal;
  shortfall_kg: Decimal;
  suggested_action: "buy_trading" | "reduce_order" | null;
}

/** demand_shortfall rows: a by-product short at the planned heads; buy trading when a replacement price exists. */
export function shortfallRows(weekStart: ISODate, d: WeekDemandResult, buyPrice: (unit: string) => Num | null): ShortfallRow[] {
  return d.shortfalls.map((s) => ({
    week_start: weekStart, key: s.key, net_kg: s.net_kg, output_kg_at_plan: s.output_kg, shortfall_kg: s.shortfall_kg,
    suggested_action: s.shortfall_kg.gt(0) ? (buyPrice(s.key) !== null ? "buy_trading" : "reduce_order") : null,
  }));
}

// ------------------------------------------------------------------------------------------------ controls

export interface PpicControlInput {
  weekStart: ISODate;
  demand: WeekDemandResult;
  buyPrice: (unit: string) => Num | null;
  /** Notes of the yield rows in use; one containing "placeholder" marks the matrix as provisional (C42). */
  yieldNotes: (string | null)[];
  /** Units with planned surplus and their fresh / frozen reference prices (C46). */
  surplus: { key: string; kg: Num; fresh: Num | null; frozen: Num | null }[];
  /** Dates of the plan with heads > 0, and the capacity rows of those dates (C47). */
  planDates: ISODate[];
  capacity: (date: ISODate) => number | null;
  /** C44: keys with ≥ 20 working days of history, and keys with any forecast for the week. */
  historyDays: Map<string, number>;
  forecastKeys: Set<string>;
  minHistoryDays?: number;
}

export function ppicControls(x: PpicControlInput): ControlV3[] {
  const short = x.demand.shortfalls.filter((s) => s.shortfall_kg.gt(0));
  const placeholder = x.yieldNotes.some((t) => /placeholder/i.test(t ?? ""));
  const noPrice = x.surplus.filter((s) => D(s.kg).gt(0) && (s.fresh === null || s.frozen === null));
  const noCap = x.planDates.filter((d) => x.capacity(d) === null);
  const minDays = x.minHistoryDays ?? 20;
  const noFc = [...x.historyDays.entries()].filter(([k, d]) => d >= minDays && !x.forecastKeys.has(k)).map(([k]) => k).sort();
  return [
    {
      code: "C41", module: "M3", name: "By-product kurang terhadap order pada ekor rencana",
      value: n(short.length), comparator: n(0), difference: sum(short.map((s) => s.shortfall_kg)),
      status: short.length ? "PERIKSA" : "LULUS",
      action: short.length ? "Beli trading untuk kekurangan, atau kurangi order by-product; ekor tidak dinaikkan karena by-product (K1)" : "",
      detail: short.map((s) => `${s.key}: kurang ${s.shortfall_kg.toFixed(0)} kg (${x.buyPrice(s.key) !== null ? "beli trading" : "kurangi order"})`),
    },
    {
      code: "C42", module: "M3", name: "Yield matrix bukan placeholder",
      value: n(placeholder ? 1 : 0), comparator: n(0), difference: n(placeholder ? 1 : 0),
      status: !x.yieldNotes.length ? "BELUM DIISI" : placeholder ? "BELUM DIISI" : "LULUS",
      action: placeholder || !x.yieldNotes.length ? "PPIC mengisi yield sebenarnya; rencana boleh disimpan dengan label yield sementara, tidak boleh disalin ke batch" : "",
      detail: placeholder ? ["yield sementara (placeholder)"] : [],
    },
    {
      code: "C44", module: "M3", name: "SKU dengan histori ≥ 20 hari kerja punya forecast",
      value: n(noFc.length), comparator: n(0), difference: n(noFc.length),
      status: noFc.length ? "BELUM DIISI" : "LULUS", action: noFc.length ? "Upload forecast Sales atau periksa forecast statistik" : "", detail: noFc,
    },
    {
      code: "C46", module: "M3", name: "Harga fresh dan frozen terisi untuk SKU bersurplus",
      value: n(noPrice.length), comparator: n(0), difference: n(noPrice.length),
      status: noPrice.length ? "BELUM DIISI" : "LULUS", action: noPrice.length ? "Isi harga acuan fresh dan frozen; rencana tidak bisa disetujui" : "",
      detail: noPrice.map((s) => `${s.key}: surplus ${D(s.kg).toFixed(0)} kg, harga ${s.fresh === null ? "fresh" : "frozen"} kosong`),
    },
    {
      code: "C47", module: "M3", name: "Tanggal rencana punya kapasitas",
      value: n(noCap.length), comparator: n(0), difference: n(noCap.length),
      status: !x.planDates.length ? "BELUM DIISI" : noCap.length ? "BELUM DIISI" : "LULUS",
      action: noCap.length || !x.planDates.length ? "PPIC mengisi kapasitas potong per tanggal; rencana harian tanpa batas tidak boleh disalin ke batch" : "", detail: noCap,
    },
  ];
}

const passing = (s: ControlV3Status) => s === "LULUS";

/** What stops an action (§6.4): save needs C45 not STALE; approve needs C46; copy to batch needs C42, C45, C46, C47 LULUS. */
export function ppicBlockers(controls: { code: string; status: ControlV3Status; action?: string }[], action: "save" | "approve" | "copy"): { code: string; status: ControlV3Status; action: string }[] {
  const need = action === "save" ? ["C45"] : action === "approve" ? ["C45", "C46"] : ["C42", "C45", "C46", "C47"];
  return controls.filter((c) => need.includes(c.code) && (action === "save" ? c.status === "STALE" || c.status === "GAGAL" : !passing(c.status)))
    .map((c) => ({ code: c.code, status: c.status, action: c.action ?? "" }));
}

/**
 * Step gates of the Rencana page (§6.4): a step opens when every control of the step before is LULUS, or PERIKSA with
 * a written reason. Step 1 demand (C41, C44, C45), step 2 weekly plan (C42, C46), step 3 daily plan (C30, C47).
 */
export function stepGates(controls: { code: string; status: ControlV3Status }[], reasons: string[] = []): { step: number; open: boolean; blockedBy: string[] }[] {
  const steps: string[][] = [["C41", "C44", "C45"], ["C42", "C46"], ["C30", "C47"]];
  const out: { step: number; open: boolean; blockedBy: string[] }[] = [{ step: 1, open: true, blockedBy: [] }];
  let open = true;
  steps.forEach((codes, i) => {
    const bad = controls.filter((c) => codes.includes(c.code) && !(c.status === "LULUS" || c.status === "N/A" || (c.status === "PERIKSA" && reasons.includes(c.code))));
    open = open && bad.length === 0;
    out.push({ step: i + 2, open, blockedBy: bad.map((c) => c.code) });
  });
  return out;
}

// ------------------------------------------------------------------------------------------------ P3.7 actual vs plan

export interface PlanVarianceRow {
  date: ISODate;
  key: string;
  planned_kg: Decimal | null;
  actual_kg: Decimal | null;
  variance_kg: Decimal | null;
  planned_heads: number | null;
  actual_heads: number | null;
}

/**
 * plan_variance_daily: per production unit per day, actual output (Aktual batches, batch_output_sku mapped to units)
 * − the plan day's target; heads actual − planned on every row of the day. A day without plan or without actual keeps
 * that side null (never 0).
 */
export function planVarianceDaily(x: {
  planDays: { date: ISODate; head_count: number; target_kg_by_key: Record<string, Num> }[];
  actualOutput: { date: ISODate; unit: string; kg: Num }[];
  actualHeads: { date: ISODate; heads: number }[];
  from: ISODate;
  to: ISODate;
}): PlanVarianceRow[] {
  const out: PlanVarianceRow[] = [];
  for (let d = x.from; d <= x.to; d = addDays(d, 1)) {
    const plan = x.planDays.find((p) => p.date === d) ?? null;
    const act = x.actualOutput.filter((a) => a.date === d);
    const heads = x.actualHeads.filter((h) => h.date === d);
    const ah = heads.length ? heads.reduce((a, h) => a + h.heads, 0) : null;
    const units = new Set([...Object.keys(plan?.target_kg_by_key ?? {}), ...act.map((a) => a.unit)]);
    for (const u of [...units].sort()) {
      const p = plan && plan.target_kg_by_key[u] !== undefined ? D(plan.target_kg_by_key[u]) : null;
      const a = act.some((q) => q.unit === u) ? sum(act.filter((q) => q.unit === u).map((q) => D(q.kg))) : null;
      out.push({ date: d, key: u, planned_kg: p, actual_kg: a, variance_kg: p !== null && a !== null ? a.minus(p) : null, planned_heads: plan ? plan.head_count : null, actual_heads: ah });
    }
  }
  return out;
}

/** First delivery date of the week's open orders, for netting at the delivery date (P3.3); null without orders. */
export function firstDelivery(orders: { delivery_date: ISODate | null }[], weekStart: ISODate): ISODate | null {
  const end = addDays(weekStart, 6);
  const ds = orders.map((o) => o.delivery_date).filter((d): d is ISODate => !!d && d >= weekStart && d <= end).sort();
  return ds[0] ?? null;
}

/** Days from the stock date to a delivery (eligibility on the delivery date, P3.3); at least 1. */
export const daysAheadOf = (stockDate: ISODate, delivery: ISODate | null, fallback = 1) => (delivery ? Math.max(1, diffDays(delivery, stockDate)) : fallback);
