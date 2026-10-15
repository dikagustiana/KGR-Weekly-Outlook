/**
 * M3 — demand (PRD v3 §4.4 steps 1–3). Pure functions, decimal.js.
 *
 * Two layers, both from the specification files:
 *  A. statistical forecast per SKU (KGR_Demand_Forecast.xlsx O_Demand_Rate / O_Demand_Forecast): censored demand
 *     rate (average of "Normal" days only — stockout days excluded), × weekday seasonality × holiday uplift ×
 *     scenario multiplier (tier) × MEV × trend, rounded to 0,1 kg per day;
 *  B. the app's weekly demand: PO lines by delivery week split by demand status, weighted (Confirmed 100%,
 *     Tentative / Forecast from parameters, Q20), netted against free stock still sellable on the delivery date and
 *     substitutes (Q7), converted to heads per weight class through the yield matrix; the SKU needing the most heads
 *     is the binding cut (O_Optimizer B16/B20).
 */
import { D, Decimal, ZERO, div, max, min, sum, type Num } from "./decimal";
import { diffDays, type ISODate } from "./dates";
import { outstandingKg } from "./delivery";

// ------------------------------------------------------------------------------------------------ A. forecast

export type Scenario = "bear" | "base" | "bull";
export const SCENARIOS: Scenario[] = ["bear", "base", "bull"];

export interface SalesHistoryRow {
  date: ISODate;
  sku: string;
  kg: Num;
  /** "Normal" | "Stockout": stockout days are censored (excluded from the rate). */
  flag: string | null;
}

export interface DemandRate {
  sku: string;
  avgDaily: Decimal;
  days: number;
  stockoutDays: number;
}

/** O_Demand_Rate: AVERAGEIFS(kg, sku, "Normal"); IFERROR → 0. */
export function demandRate(history: SalesHistoryRow[], skus: string[]): DemandRate[] {
  return skus.map((sku) => {
    const rows = history.filter((h) => h.sku === sku);
    const normal = rows.filter((h) => h.flag === "Normal");
    return {
      sku, days: rows.length, stockoutDays: rows.filter((h) => h.flag === "Stockout").length,
      avgDaily: normal.length ? sum(normal.map((h) => D(h.kg))).div(normal.length) : ZERO,
    };
  });
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function weekdayName(d: ISODate): string {
  const [y, m, day] = d.split("-").map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()];
}

export interface ForecastConfig {
  days: ISODate[];
  /** Weekday name → index (1,00 = average). Missing weekday = 1. */
  seasonality: Record<string, Num>;
  /** Holiday / Lebaran uplift per date (multiplies the weekday index). */
  overrides?: { date: ISODate; uplift: Num }[];
  /** Tier → bear / bull factor (base = 1). */
  tiers: Record<string, { bear: Num; bull: Num }>;
  skuTier: Record<string, string>;
  mev: Record<Scenario, Num>;
  trendMode: "Flat" | "Clamped" | string;
  trendClamp: Num;
  wowTrend?: Record<string, Num | null>;
}

export interface ForecastRow {
  sku: string;
  scenario: Scenario;
  days: Decimal[];
  total: Decimal;
}

/** Day index of the forecast (O_Demand_Forecast row 4): weekday seasonality × holiday uplift. */
export function dayIndex(cfg: ForecastConfig, d: ISODate): Decimal {
  const s = cfg.seasonality[weekdayName(d)];
  const o = cfg.overrides?.find((x) => x.date === d);
  return (s === undefined || s === null || s === "" ? D(1) : D(s)).times(o ? D(o.uplift) : D(1));
}

export function scenarioMultiplier(cfg: ForecastConfig, sku: string, sc: Scenario): Decimal {
  if (sc === "base") return D(1);
  const t = cfg.tiers[cfg.skuTier[sku] ?? ""];
  return t ? D(sc === "bear" ? t.bear : t.bull) : D(1);
}

/** O_Demand_Forecast: ROUND(rate × day index × scenario × MEV × trend, 1) per SKU × scenario × day. */
export function forecastDaily(rates: DemandRate[], cfg: ForecastConfig): ForecastRow[] {
  const out: ForecastRow[] = [];
  const clamp = D(cfg.trendClamp);
  for (const r of rates) {
    const wow = D(cfg.wowTrend?.[r.sku] ?? 0);
    const trend = cfg.trendMode === "Flat" ? D(1) : D(1).plus(max(min(wow, clamp), clamp.neg()));
    for (const sc of SCENARIOS) {
      const f = r.avgDaily.times(scenarioMultiplier(cfg, r.sku, sc)).times(D(cfg.mev[sc])).times(trend);
      const days = cfg.days.map((d) => f.times(dayIndex(cfg, d)).toDecimalPlaces(1, Decimal.ROUND_HALF_UP));
      out.push({ sku: r.sku, scenario: sc, days, total: sum(days) });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ B. weekly demand

export type DemandStatus = "Confirmed" | "Tentative" | "Forecast";

export interface OrderLine {
  ref: string;
  key: string;
  delivery_date: ISODate | null;
  demand_status: DemandStatus | string | null;
  kg: Num;
  /** kg already delivered (fulfilled_kg). */
  fulfilled_kg?: Num | null;
  /** K7: kg cancelled on the line. */
  cancelled_kg?: Num | null;
  price?: Num | null;
  customer?: string | null;
}

export interface ForecastLine {
  week_start: ISODate;
  key: string;
  kg: Num;
  price_expected?: Num | null;
  sales_rep?: string | null;
}

export interface DemandWeights {
  tentative: Num;
  forecast: Num;
}

export interface WeeklyDemandRow {
  key: string;
  confirmed_kg: Decimal;
  tentative_kg: Decimal;
  /** PO lines with status Forecast + forecast_line kg (unweighted). */
  forecast_kg: Decimal;
  /** confirmed + tentative × w_t + forecast × w_f */
  weighted_kg: Decimal;
}

/** Step 1: Σ open PO lines with delivery date in [weekStart, weekStart+6] per status, + forecast lines of the week. */
export function weeklyDemand(x: { orders: OrderLine[]; forecasts: ForecastLine[]; weights: DemandWeights; weekStart: ISODate }): WeeklyDemandRow[] {
  const m = new Map<string, WeeklyDemandRow>();
  const row = (key: string) => {
    let r = m.get(key);
    if (!r) { r = { key, confirmed_kg: ZERO, tentative_kg: ZERO, forecast_kg: ZERO, weighted_kg: ZERO }; m.set(key, r); }
    return r;
  };
  for (const o of x.orders) {
    if (!o.delivery_date) continue;
    const dd = diffDays(o.delivery_date, x.weekStart);
    if (dd < 0 || dd > 6) continue;
    const open = outstandingKg(o);
    const r = row(o.key);
    if (o.demand_status === "Tentative") r.tentative_kg = r.tentative_kg.plus(open);
    else if (o.demand_status === "Forecast") r.forecast_kg = r.forecast_kg.plus(open);
    else r.confirmed_kg = r.confirmed_kg.plus(open);
  }
  for (const f of x.forecasts) if (f.week_start === x.weekStart) row(f.key).forecast_kg = row(f.key).forecast_kg.plus(D(f.kg));
  for (const r of m.values()) r.weighted_kg = r.confirmed_kg.plus(r.tentative_kg.times(D(x.weights.tentative))).plus(r.forecast_kg.times(D(x.weights.forecast)));
  return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export interface Substitution {
  key_demand: string;
  key_substitute: string;
  priority: number;
  /** Max share of the demand the substitute may cover (0–1). */
  max_pct: Num;
}

export interface NetDemandRow {
  key: string;
  demand_kg: Decimal;
  stock_used_kg: Decimal;
  substituted_kg: Decimal;
  substitutes: { key: string; kg: Decimal }[];
  net_kg: Decimal;
}

/** Free stock still sellable on the delivery date (fresh: age ≤ window hours; frozen: age ≤ limit days). */
export function eligibleFree(
  lots: { key: string; form: "fresh" | "frozen"; free_kg: Num; age_days: number }[],
  daysAhead: number,
  windows: { freshHours: (key: string) => number; frozenDays: (key: string) => number },
): Map<string, Decimal> {
  const m = new Map<string, Decimal>();
  for (const l of lots) {
    const age = l.age_days + daysAhead;
    const ok = l.form === "fresh" ? age * 24 <= windows.freshHours(l.key) : age <= windows.frozenDays(l.key);
    if (ok && D(l.free_kg).gt(0)) m.set(l.key, (m.get(l.key) ?? ZERO).plus(D(l.free_kg)));
  }
  return m;
}

/** Step 2: demand − own eligible free stock, then substitutes in priority order (each ≤ max_pct of the demand). */
export function netDemand(x: { demand: { key: string; kg: Num }[]; free: Map<string, Decimal>; substitutions?: Substitution[] }): NetDemandRow[] {
  const free = new Map([...x.free.entries()].map(([k, v]) => [k, v]));
  const rows: NetDemandRow[] = [];
  for (const d of x.demand) {
    const dem = D(d.kg);
    const own = min(dem, max(ZERO, free.get(d.key) ?? ZERO));
    free.set(d.key, (free.get(d.key) ?? ZERO).minus(own));
    let left = dem.minus(own);
    const subs: { key: string; kg: Decimal }[] = [];
    for (const s of (x.substitutions ?? []).filter((q) => q.key_demand === d.key).sort((a, b) => a.priority - b.priority)) {
      if (!left.gt(0)) break;
      const cap = dem.times(D(s.max_pct));
      const kg = min(min(left, cap), max(ZERO, free.get(s.key_substitute) ?? ZERO));
      if (!kg.gt(0)) continue;
      free.set(s.key_substitute, (free.get(s.key_substitute) ?? ZERO).minus(kg));
      subs.push({ key: s.key_substitute, kg });
      left = left.minus(kg);
    }
    rows.push({ key: d.key, demand_kg: dem, stock_used_kg: own, substituted_kg: sum(subs.map((q) => q.kg)), substitutes: subs, net_kg: left });
  }
  return rows;
}

export interface HeadsRow {
  key: string;
  net_kg: Decimal;
  kg_per_head: Decimal;
  /** net_kg / kg per head (unrounded, O_Optimizer G:I). */
  heads: Decimal;
}

export interface HeadsResult {
  weight_class: string;
  avg_lb_kg: Decimal;
  rows: HeadsRow[];
  /** SKU that needs the most heads (O_Optimizer B16). */
  binding: string | null;
  maxHeads: Decimal;
  minHeads: Decimal;
  /** Heads to buy to cover every SKU: ceil(max) (PRD v3 §4.4 step 3). */
  heads: number;
}

/**
 * Step 3: heads per weight class. kg per head of a key = yield % of live weight (yield matrix of the class and the cut
 * pattern) × average live weight of the class. Keys without a yield are skipped (purchased, not cut).
 */
export function toHeads(x: { net: { key: string; kg: Num }[]; yieldPct: (key: string) => Num | null; avgLbKg: Num; weightClass?: string }): HeadsResult {
  const avg = D(x.avgLbKg);
  const rows: HeadsRow[] = [];
  for (const n of x.net) {
    const y = x.yieldPct(n.key);
    if (y === null || y === undefined || y === "" || D(y).isZero()) continue;
    const kgPerHead = D(y).times(avg);
    rows.push({ key: n.key, net_kg: D(n.kg), kg_per_head: kgPerHead, heads: div(D(n.kg), kgPerHead) });
  }
  let binding: HeadsRow | null = null;
  for (const r of rows) if (!binding || r.heads.gt(binding.heads)) binding = r;
  const maxHeads = binding?.heads ?? ZERO;
  const minHeads = rows.reduce((m, r) => (m === null || r.heads.lt(m) ? r.heads : m), null as Decimal | null) ?? ZERO;
  return {
    weight_class: x.weightClass ?? "", avg_lb_kg: avg, rows, binding: binding?.key ?? null, maxHeads, minHeads,
    heads: maxHeads.isZero() ? 0 : maxHeads.toDecimalPlaces(0, Decimal.ROUND_CEIL).toNumber(),
  };
}

export interface PatternYield {
  pattern: string;
  key: string;
  yield_pct: Num;
}

export interface PatternHeads {
  pattern: string;
  heads: number;
  /** SKU exclusive to the pattern that sets its heads (null when only shared SKUs added heads). */
  binding: string | null;
  rows: HeadsRow[];
}

export interface HeadsByPatternResult {
  avg_lb_kg: Decimal;
  patterns: PatternHeads[];
  heads: number;
  /** Shared SKUs (yield in several patterns) that needed heads on top of the exclusive SKUs' heads. */
  topUps: { key: string; pattern: string; short_kg: Decimal; heads: number }[];
  /** Keys with net demand but no yield in any pattern (bought, not cut). */
  notCut: string[];
}

/**
 * Step 3 with several cut patterns (karkas whole, boneless, parting): one head is cut in one pattern only.
 * SKUs found in exactly one pattern set that pattern's heads (ceil of the binding SKU, toHeads); SKUs found in several
 * patterns (by-products) are covered by the heads already planned in every pattern, and any shortfall adds heads to the
 * pattern with the highest yield for them (first in `order` on a tie).
 */
export function headsByPattern(x: { net: { key: string; kg: Num }[]; yields: PatternYield[]; avgLbKg: Num; order?: string[] }): HeadsByPatternResult {
  const avg = D(x.avgLbKg);
  const order = [...(x.order ?? []), ...x.yields.map((y) => y.pattern)].filter((p, i, a) => a.indexOf(p) === i);
  const y = new Map<string, Map<string, Decimal>>();
  for (const r of x.yields) {
    if (D(r.yield_pct).isZero()) continue;
    if (!y.has(r.key)) y.set(r.key, new Map());
    y.get(r.key)!.set(r.pattern, D(r.yield_pct));
  }
  const need = x.net.filter((n) => D(n.kg).gt(0));
  const notCut = need.filter((n) => !y.has(n.key)).map((n) => n.key);
  const patterns: PatternHeads[] = order.map((p) => {
    const excl = need.filter((n) => y.get(n.key)?.size === 1 && y.get(n.key)!.has(p));
    const h = toHeads({ net: excl, yieldPct: (k) => y.get(k)?.get(p)?.toString() ?? null, avgLbKg: avg });
    return { pattern: p, heads: h.heads, binding: h.binding, rows: h.rows };
  }).filter((p) => p.heads > 0 || need.some((n) => y.get(n.key)?.has(p.pattern)));
  const byName = new Map(patterns.map((p) => [p.pattern, p]));
  const topUps: HeadsByPatternResult["topUps"] = [];
  for (const n of need.filter((q) => (y.get(q.key)?.size ?? 0) > 1).sort((a, b) => a.key.localeCompare(b.key))) {
    const ys = y.get(n.key)!;
    const supply = sum([...ys.entries()].map(([p, v]) => D(byName.get(p)?.heads ?? 0).times(avg).times(v)));
    const short = D(n.kg).minus(supply);
    if (!short.gt(0)) continue;
    let best: string | null = null;
    for (const p of order) if (ys.has(p) && (best === null || ys.get(p)!.gt(ys.get(best)!))) best = p;
    if (best === null) continue;
    const add = short.div(avg.times(ys.get(best)!)).toDecimalPlaces(0, Decimal.ROUND_CEIL).toNumber();
    let ph = byName.get(best);
    if (!ph) { ph = { pattern: best, heads: 0, binding: null, rows: [] }; byName.set(best, ph); patterns.push(ph); }
    ph.heads += add;
    topUps.push({ key: n.key, pattern: best, short_kg: short, heads: add });
  }
  return { avg_lb_kg: avg, patterns, heads: patterns.reduce((a, p) => a + p.heads, 0), topUps, notCut };
}

export interface WeekDemandInput {
  weekStart: ISODate;
  orders: OrderLine[];
  forecasts: ForecastLine[];
  weights: DemandWeights;
  /** Free stock per lot on the stock date (lot_balance_daily). */
  freeLots: { key: string; form: "fresh" | "frozen"; free_kg: Num; age_days: number }[];
  /** Days from the stock date to the first delivery the stock can serve. */
  daysAhead: number;
  windows: { freshHours: (key: string) => number; frozenDays: (key: string) => number };
  substitutions: Substitution[];
  /** Production unit of a key (SKU cut from live birds, fresh and frozen share it); null = bought, not cut. */
  unitOf: (key: string) => string | null;
  /** Yields of the weight class per pattern, keyed by production unit. */
  yields: PatternYield[];
  avgLbKg: Num;
  patternOrder?: string[];
  /** Karkas yield of the class (karkas pattern), for the karkas-equivalent column. */
  karkasYield?: Num | null;
}

export interface DemandWeeklyRow {
  key: string;
  confirmed_kg: Decimal;
  tentative_kg: Decimal;
  forecast_kg: Decimal;
  weighted_kg: Decimal;
  /** Own eligible free stock netted against the demand. */
  stock_free_kg: Decimal;
  substituted_kg: Decimal;
  net_kg: Decimal;
  unit: string | null;
  cut_pattern: string | null;
  kg_per_head: Decimal | null;
  /** net kg / kg per head (unrounded) — heads this key alone would need. */
  heads: Decimal | null;
  karkas_kg_equiv: Decimal | null;
  binding: boolean;
}

export interface WeekDemandResult {
  rows: DemandWeeklyRow[];
  /** Net kg per production unit (what the cut must deliver). */
  unitNet: { key: string; kg: Decimal }[];
  heads: HeadsByPatternResult;
  /** Binding unit per pattern. */
  binding: string[];
  totals: { weighted_kg: Decimal; stock_free_kg: Decimal; net_kg: Decimal };
}

/** Steps 1–3 (PRD v3 §4.4) for one week: weighted demand → netting → heads by pattern. */
export function weekDemand(x: WeekDemandInput): WeekDemandResult {
  const wd = weeklyDemand({ orders: x.orders, forecasts: x.forecasts, weights: x.weights, weekStart: x.weekStart });
  const free = eligibleFree(x.freeLots, x.daysAhead, x.windows);
  const net = netDemand({ demand: wd.map((r) => ({ key: r.key, kg: r.weighted_kg })), free, substitutions: x.substitutions });
  const units = new Map<string, Decimal>();
  for (const n of net) {
    const u = x.unitOf(n.key);
    if (u !== null && n.net_kg.gt(0)) units.set(u, (units.get(u) ?? ZERO).plus(n.net_kg));
  }
  const unitNet = [...units.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([key, kg]) => ({ key, kg }));
  const heads = headsByPattern({ net: unitNet, yields: x.yields, avgLbKg: x.avgLbKg, order: x.patternOrder });
  const avg = D(x.avgLbKg);
  const binding = heads.patterns.map((p) => p.binding).filter((b): b is string => b !== null);
  // pattern of a unit: where it is exclusive, else where its shortfall went, else its highest yield
  const patternOf = (u: string): string | null => {
    const ys = x.yields.filter((y) => y.key === u && !D(y.yield_pct).isZero());
    if (!ys.length) return null;
    if (ys.length === 1) return ys[0].pattern;
    const t = heads.topUps.find((q) => q.key === u);
    if (t) return t.pattern;
    // served by the patterns already cut: the one with heads and the highest yield
    const cut = ys.filter((y) => heads.patterns.some((p) => p.pattern === y.pattern && p.heads > 0));
    return (cut.length ? cut : ys).reduce((a, b) => (D(b.yield_pct).gt(D(a.yield_pct)) ? b : a)).pattern;
  };
  const byKey = new Map(net.map((n) => [n.key, n]));
  const rows = wd.map((w): DemandWeeklyRow => {
    const n = byKey.get(w.key)!;
    const u = x.unitOf(w.key);
    const p = u === null ? null : patternOf(u);
    const y = p === null ? null : x.yields.find((q) => q.pattern === p && q.key === u) ?? null;
    const kgPerHead = y ? avg.times(D(y.yield_pct)) : null;
    const h = kgPerHead && !kgPerHead.isZero() ? n.net_kg.div(kgPerHead) : null;
    return {
      key: w.key, confirmed_kg: w.confirmed_kg, tentative_kg: w.tentative_kg, forecast_kg: w.forecast_kg, weighted_kg: w.weighted_kg,
      stock_free_kg: n.stock_used_kg, substituted_kg: n.substituted_kg, net_kg: n.net_kg, unit: u, cut_pattern: p, kg_per_head: kgPerHead, heads: h,
      karkas_kg_equiv: h !== null && x.karkasYield !== null && x.karkasYield !== undefined ? h.times(avg).times(D(x.karkasYield)) : null,
      binding: u !== null && binding.includes(u),
    };
  });
  const totals = { weighted_kg: sum(rows.map((r) => r.weighted_kg)), stock_free_kg: sum(rows.map((r) => r.stock_free_kg)), net_kg: sum(rows.map((r) => r.net_kg)) };
  return { rows, unitNet, heads, binding, totals };
}
