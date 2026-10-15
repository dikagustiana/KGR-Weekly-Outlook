/**
 * M3 — plan (PRD v3 §4.4 steps 4–5). Pure functions, decimal.js.
 *
 * jointEconomics reproduces KGR_Demand_Forecast.xlsx O_Optimizer section C: buying N heads gives N × kg/head of
 * every cut (joint production); what demand does not take is surplus — frozen-capable surplus is worth
 * price × frozen factor − handling per kg, the rest the salvage value; profit = revenue + surplus value − N × cost
 * per head, per scenario, weighted into an expected profit.
 * weeklyPlan / dailyPlan are the app's plan: heads = max(fresh need, committed supply) within capacity; the surplus
 * per SKU is planned frozen at a downgrade of (fresh − frozen price) × kg that needs approval above the threshold.
 */
import { D, Decimal, ZERO, div, max, min, sum, type Num } from "./decimal";
import { addDays, type ISODate } from "./dates";
import { SCENARIOS, type Scenario } from "./demand";

export interface JointPart {
  sku: string;
  kgPerHead: Num;
  price: Num;
  frozenCapable: boolean;
  frozenFactor: Num;
}

export interface JointInput {
  heads: Num;
  parts: JointPart[];
  /** 7-day demand per scenario per SKU. */
  demand: Record<Scenario, Record<string, Num>>;
  handlingPerKg: Num;
  salvagePerKg: Num;
  costPerHead: Num;
  freezerCapacityKg: Num;
  weights: Record<Scenario, Num>;
}

export interface JointRow {
  sku: string;
  kgPerHead: Decimal;
  supply: Decimal;
  demandBase: Decimal;
  sold: Decimal;
  surplus: Decimal;
  shortfall: Decimal;
  fill: Decimal;
  frozen: boolean;
  surplusValue: Decimal;
  revenue: Decimal;
  contribution: Record<Scenario, Decimal>;
}

export interface JointResult {
  heads: Decimal;
  rows: JointRow[];
  sold: Decimal;
  surplus: Decimal;
  shortfall: Decimal;
  surplusValue: Decimal;
  revenue: Decimal;
  cost: Decimal;
  profit: Record<Scenario, Decimal>;
  expectedProfit: Decimal;
  surplusToFreeze: Decimal;
  freezerOk: boolean;
}

/** Value of the part of one SKU's supply a scenario's demand takes, plus its surplus (O_Optimizer K/L/M). */
function contribution(supply: Decimal, demand: Decimal, p: JointPart, handling: Decimal, salvage: Decimal): { sold: Decimal; surplus: Decimal; value: Decimal; surplusValue: Decimal } {
  const sold = min(supply, demand);
  const surplus = max(supply.minus(demand), ZERO);
  const price = D(p.price);
  const surplusValue = p.frozenCapable ? surplus.times(price).times(D(p.frozenFactor)).minus(surplus.times(handling)) : surplus.times(salvage);
  return { sold, surplus, value: sold.times(price).plus(surplusValue), surplusValue };
}

export function jointEconomics(x: JointInput): JointResult {
  const N = D(x.heads);
  const handling = D(x.handlingPerKg), salvage = D(x.salvagePerKg);
  const rows: JointRow[] = x.parts.map((p) => {
    const kgPerHead = D(p.kgPerHead);
    const supply = N.times(kgPerHead);
    const dem = (sc: Scenario) => D(x.demand[sc][p.sku] ?? 0);
    const base = contribution(supply, dem("base"), p, handling, salvage);
    const c = Object.fromEntries(SCENARIOS.map((sc) => [sc, contribution(supply, dem(sc), p, handling, salvage).value])) as Record<Scenario, Decimal>;
    return {
      sku: p.sku, kgPerHead, supply, demandBase: dem("base"), sold: base.sold, surplus: base.surplus,
      shortfall: max(dem("base").minus(supply), ZERO), fill: div(base.sold, dem("base")), frozen: p.frozenCapable,
      surplusValue: base.surplusValue, revenue: base.sold.times(D(p.price)), contribution: c,
    };
  });
  const cost = N.times(D(x.costPerHead));
  const revenue = sum(rows.map((r) => r.revenue));
  const surplusValue = sum(rows.map((r) => r.surplusValue));
  const profit: Record<Scenario, Decimal> = {
    bear: sum(rows.map((r) => r.contribution.bear)).minus(cost),
    base: revenue.plus(surplusValue).minus(cost),
    bull: sum(rows.map((r) => r.contribution.bull)).minus(cost),
  };
  const surplusToFreeze = sum(rows.filter((r) => r.frozen).map((r) => r.surplus));
  return {
    heads: N, rows, sold: sum(rows.map((r) => r.sold)), surplus: sum(rows.map((r) => r.surplus)), shortfall: sum(rows.map((r) => r.shortfall)),
    surplusValue, revenue, cost, profit,
    expectedProfit: SCENARIOS.reduce((a, sc) => a.plus(D(x.weights[sc]).times(profit[sc])), ZERO),
    surplusToFreeze, freezerOk: !surplusToFreeze.gt(D(x.freezerCapacityKg)),
  };
}

export interface PlanPart {
  key: string;
  kgPerHead: Num;
  /** Weighted demand of the week (kg) the fresh output serves. */
  demandKg: Num;
  priceFresh: Num | null;
  priceFrozen: Num | null;
}

export interface WeeklyPlanResult {
  /** Heads the demand needs (binding cut). */
  headsNeeded: number;
  /** Planned heads = max(needed, committed supply), capped at capacity. */
  head_count: number;
  cappedByCapacity: boolean;
  shortHeads: number;
  output_kg_by_key: Record<string, Decimal>;
  surplus_kg_by_key: Record<string, Decimal>;
  frozen_planned_kg: Decimal;
  /** Σ (price fresh − price frozen) × surplus kg. */
  rp_downgrade: Decimal;
  needsApproval: boolean;
}

/** Step 4 (PRD v3 §4.4): plan_week. */
export function weeklyPlan(x: { headsNeeded: number; supplyCommittedHeads?: number; capacityHeads?: number | null; parts: PlanPart[]; threshold: Num }): WeeklyPlanResult {
  const want = Math.max(x.headsNeeded, x.supplyCommittedHeads ?? 0);
  const cap = x.capacityHeads ?? null;
  const head_count = cap !== null ? Math.min(want, cap) : want;
  const output: Record<string, Decimal> = {}, surplus: Record<string, Decimal> = {};
  let frozen = ZERO, down = ZERO;
  for (const p of x.parts) {
    const out = D(head_count).times(D(p.kgPerHead));
    output[p.key] = out;
    const s = max(ZERO, out.minus(D(p.demandKg)));
    surplus[p.key] = s;
    frozen = frozen.plus(s);
    if (p.priceFresh !== null && p.priceFrozen !== null && p.priceFresh !== undefined && p.priceFrozen !== undefined) {
      down = down.plus(max(ZERO, D(p.priceFresh).minus(D(p.priceFrozen))).times(s));
    }
  }
  return {
    headsNeeded: x.headsNeeded, head_count, cappedByCapacity: cap !== null && want > cap, shortHeads: Math.max(0, x.headsNeeded - head_count),
    output_kg_by_key: output, surplus_kg_by_key: surplus, frozen_planned_kg: frozen, rp_downgrade: down, needsApproval: down.gt(D(x.threshold)),
  };
}

export interface DayNeed {
  /** Delivery date of the orders the cut serves. */
  delivery_date: ISODate;
  heads: number;
}

export interface DayLimit {
  date: ISODate;
  cut_capacity_head?: number | null;
  /** Heads of live bird confirmed for the day (lb_supply status confirmed / received). */
  lb_supply_heads?: number | null;
}

export interface DailyPlanRow {
  date: ISODate;
  head_count: number;
  /** Heads that could not be placed on their day (capacity / supply) and moved earlier. */
  moved_from_later: number;
  limited_by: "capacity" | "supply" | null;
}

/**
 * Step 5: plan_day. Heads are cut on delivery date − lead time; a day that exceeds its cutting capacity or confirmed
 * live-bird supply pushes the excess to the day before (the plan never cuts after the delivery). What does not fit
 * at all is reported in `unplaced`.
 */
export function dailyPlan(x: { weekHeads: number; needs: DayNeed[]; limits: DayLimit[]; leadTimeDays: number; weekStart: ISODate }): { rows: DailyPlanRow[]; unplaced: number } {
  const days = Array.from({ length: 7 }, (_, i) => addDays(x.weekStart, i));
  const want = new Map<ISODate, number>(days.map((d) => [d, 0]));
  let needTotal = 0;
  for (const n of x.needs) {
    let d = addDays(n.delivery_date, -x.leadTimeDays);
    if (d < x.weekStart) d = x.weekStart;
    if (d > days[6]) d = days[6];
    want.set(d, (want.get(d) ?? 0) + n.heads);
    needTotal += n.heads;
  }
  // heads the week plan adds above the orders' need (committed supply) go to the first day
  if (x.weekHeads > needTotal) want.set(days[0], (want.get(days[0]) ?? 0) + (x.weekHeads - needTotal));
  const lim = new Map(x.limits.map((l) => [l.date, l]));
  const rows: DailyPlanRow[] = days.map((date) => ({ date, head_count: 0, moved_from_later: 0, limited_by: null }));
  let carry = 0;
  for (let i = 6; i >= 0; i--) {
    const r = rows[i];
    const l = lim.get(r.date);
    const capC = l?.cut_capacity_head ?? Infinity;
    const capS = l?.lb_supply_heads ?? Infinity;
    const cap = Math.min(capC, capS);
    const total = (want.get(r.date) ?? 0) + carry;
    r.head_count = Math.min(total, cap);
    r.moved_from_later = carry;
    carry = total - r.head_count;
    if (carry > 0) r.limited_by = capS < capC ? "supply" : "capacity";
  }
  return { rows, unplaced: carry };
}

/**
 * Plan parts from a pattern mix (headsByPattern): kg per head of a SKU = Σ pattern share × avg LB × yield in that
 * pattern, so head_count × kg per head = what the planned mix cuts. Demand = net kg the fresh output serves.
 */
export function mixParts(x: {
  patterns: { pattern: string; heads: number }[];
  yields: { pattern: string; key: string; yield_pct: Num }[];
  avgLbKg: Num;
  demand: { key: string; kg: Num }[];
  prices: Record<string, { fresh: Num | null; frozen: Num | null }>;
}): PlanPart[] {
  const total = x.patterns.reduce((a, p) => a + p.heads, 0);
  const avg = D(x.avgLbKg);
  const keys = [...new Set(x.yields.filter((y) => x.patterns.some((p) => p.pattern === y.pattern && p.heads > 0)).map((y) => y.key))].sort();
  const dem = new Map(x.demand.map((d) => [d.key, D(d.kg)]));
  return keys.map((key) => {
    const kgPerHead = total === 0 ? ZERO : sum(x.patterns.map((p) => {
      const y = x.yields.find((q) => q.pattern === p.pattern && q.key === key);
      return y ? D(p.heads).div(total).times(avg).times(D(y.yield_pct)) : ZERO;
    }));
    const pr = x.prices[key];
    return { key, kgPerHead, demandKg: dem.get(key) ?? ZERO, priceFresh: pr?.fresh ?? null, priceFrozen: pr?.frozen ?? null };
  });
}

/**
 * Heads per delivery date for dailyPlan: the week's heads split by the weighted PO kg of each delivery day, plus the
 * forecast kg (no date) spread evenly over the week; largest-remainder rounding so the days add up to the week.
 */
export function splitHeadsByDay(x: { weekHeads: number; weekStart: ISODate; orderKgByDay: Record<ISODate, Num>; forecastKg: Num }): DayNeed[] {
  const days = Array.from({ length: 7 }, (_, i) => addDays(x.weekStart, i));
  const fc = D(x.forecastKg).div(7);
  const w = days.map((d) => D(x.orderKgByDay[d] ?? 0).plus(fc));
  const tot = sum(w);
  if (x.weekHeads <= 0 || tot.isZero()) return [];
  const raw = w.map((v) => v.times(x.weekHeads).div(tot));
  const base = raw.map((v) => v.floor().toNumber());
  let left = x.weekHeads - base.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => ({ i, r: v.minus(v.floor()) })).sort((a, b) => (b.r.cmp(a.r) || a.i - b.i));
  for (const o of order) { if (left <= 0) break; base[o.i] += 1; left -= 1; }
  return days.map((d, i) => ({ delivery_date: d, heads: base[i] })).filter((n) => n.heads > 0);
}

export interface PlanBatchRow {
  date: ISODate;
  head_count: number;
  lb_kg: string;
  lb_price: string;
  freight: string;
  maklon: string;
  processed_kg: string;
  out_karkas_fresh: string;
  out_kepala: string;
  out_ceker: string;
  out_usus: string;
  out_hja: string;
  out_lemak: string;
}

/**
 * "Salin ke batch rencana": one v1 planned batch per plan day, with the v1 planning rules (I_Parameter): processed =
 * LB × (1 − target shrink), outputs = processed × default yields, freight per kg LB, maklon per kg processed.
 */
export function planBatchRow(x: {
  date: ISODate; heads: number; avgLbKg: Num; lbPrice: Num; shrink: Num; freightPerKgLb: Num; maklonPerKgProcessed: Num;
  yields: { karkas: Num; kepala: Num; ceker: Num; usus: Num; hja: Num; lemak: Num };
}): PlanBatchRow {
  const lb = D(x.heads).times(D(x.avgLbKg));
  const processed = lb.times(D(1).minus(D(x.shrink)));
  const o = (y: Num) => processed.times(D(y)).toFixed(2);
  return {
    date: x.date, head_count: x.heads, lb_kg: lb.toFixed(2), lb_price: D(x.lbPrice).toFixed(4),
    freight: lb.times(D(x.freightPerKgLb)).toFixed(2), maklon: processed.times(D(x.maklonPerKgProcessed)).toFixed(2), processed_kg: processed.toFixed(2),
    out_karkas_fresh: o(x.yields.karkas), out_kepala: o(x.yields.kepala), out_ceker: o(x.yields.ceker), out_usus: o(x.yields.usus), out_hja: o(x.yields.hja), out_lemak: o(x.yields.lemak),
  };
}

export interface WeekPlanProposal {
  plan: WeeklyPlanResult;
  parts: PlanPart[];
  /** Heads per cut pattern at the planned head count (largest remainder). */
  patternMix: Record<string, number>;
}

/** Step 4 from a week's demand result: heads needed by pattern → planned heads, output, surplus, downgrade. */
export function proposeWeekPlan(x: {
  heads: { heads: number; patterns: { pattern: string; heads: number }[] };
  unitNet: { key: string; kg: Num }[];
  yields: { pattern: string; key: string; yield_pct: Num }[];
  avgLbKg: Num;
  prices: Record<string, { fresh: Num | null; frozen: Num | null }>;
  supplyCommittedHeads?: number;
  capacityHeads?: number | null;
  threshold: Num;
  patternOrder?: string[];
}): WeekPlanProposal {
  const order = [...(x.patternOrder ?? []), ...x.yields.map((y) => y.pattern)].filter((p, i, a) => a.indexOf(p) === i);
  const need = x.heads.patterns.filter((p) => p.heads > 0);
  const base = need.length ? need : order.slice(0, 1).map((pattern) => ({ pattern, heads: 1 }));
  const parts = mixParts({ patterns: base, yields: x.yields, avgLbKg: x.avgLbKg, demand: x.unitNet, prices: x.prices });
  const plan = weeklyPlan({ headsNeeded: x.heads.heads, supplyCommittedHeads: x.supplyCommittedHeads, capacityHeads: x.capacityHeads, parts, threshold: x.threshold });
  const tot = base.reduce((a, p) => a + p.heads, 0);
  const raw = base.map((p) => D(p.heads).times(plan.head_count).div(tot || 1));
  const mix = raw.map((v) => v.floor().toNumber());
  let left = plan.head_count - mix.reduce((a, b) => a + b, 0);
  for (const o of raw.map((v, i) => ({ i, r: v.minus(v.floor()) })).sort((a, b) => b.r.cmp(a.r) || a.i - b.i)) { if (left <= 0) break; mix[o.i] += 1; left -= 1; }
  return { plan, parts, patternMix: Object.fromEntries(base.map((p, i) => [p.pattern, mix[i]]).filter(([, h]) => (h as number) > 0)) };
}

/** Weighted open PO kg per delivery day (cut keys only) and weighted forecast kg of the week, for splitHeadsByDay. */
export function demandByDay(x: { orders: { key: string; delivery_date: ISODate | null; demand_status: string | null; kg: Num; fulfilled_kg?: Num | null }[];
  forecasts: { key: string; kg: Num }[]; weights: { tentative: Num; forecast: Num }; weekStart: ISODate; isCut: (key: string) => boolean }): { orderKgByDay: Record<ISODate, Decimal>; forecastKg: Decimal } {
  const end = addDays(x.weekStart, 6);
  const by: Record<ISODate, Decimal> = {};
  for (const o of x.orders) {
    if (!o.delivery_date || o.delivery_date < x.weekStart || o.delivery_date > end || !x.isCut(o.key)) continue;
    const open = max(ZERO, D(o.kg).minus(D(o.fulfilled_kg ?? 0)));
    const w = o.demand_status === "Tentative" ? D(x.weights.tentative) : o.demand_status === "Forecast" ? D(x.weights.forecast) : D(1);
    by[o.delivery_date] = (by[o.delivery_date] ?? ZERO).plus(open.times(w));
  }
  const forecastKg = sum(x.forecasts.filter((f) => x.isCut(f.key)).map((f) => D(f.kg).times(D(x.weights.forecast))));
  return { orderKgByDay: by, forecastKg };
}
