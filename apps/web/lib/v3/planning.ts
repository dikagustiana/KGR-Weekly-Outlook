import "server-only";
/**
 * M3 demand → rencana (PRD v3 §4.4 steps 1–5). Loads rows, runs @kgr/engine (weekDemand, proposeWeekPlan,
 * demandByDay, splitHeadsByDay, dailyPlan, planningControls) and writes the results; no arithmetic here.
 */
import { commitmentDemand,
  D, addDays, dailyPlan, daysAheadOf, demandByDay, firstDelivery, keyResolver, mondayOf, outstandingKg, planVarianceDaily, planningControls, ppicBlockers, ppicControls,
  proposeWeekPlan, shortfallRows, splitHeadsByDay, statForecastWeek, toFixedString, weekDemand,
  type ControlV3, type DailyPlanRow, type Decimal, type ForecastLine, type OrderLine, type PatternYield, type Substitution, type WeekDemandResult, type WeekPlanProposal,
} from "@kgr/engine";
import { normDemandStatus, normSupplyStatus, parseV3Table, yieldFraction } from "@kgr/parsers";
import type { Supa } from "../supabase";
import type { Viewer } from "../session";
import { fetchAll, listWeeks, type WeekRow } from "../data";
import { WriteError } from "../write";
import { stockMartControl } from "./stale";
import { martReplace, registerBuilder } from "../rebuild-registry";
import { plan0, registerV3Kind, weekOfDate, type Row } from "./uploads";
import { consumeApprovals, floorGuard } from "./discount";
import { parseSetting, MODULE_KEYS, type ModuleSettings } from "../modules-core";
import { inChunks, must, mustRows, needParameter } from "../loader";

/** Module flags read with the caller's client (uploads run outside the page cache). */
async function moduleSettingsOf(sb: Supa): Promise<ModuleSettings> {
  const data = mustRows(await sb.from("app_setting").select("key, value").in("key", MODULE_KEYS), "moduleSettingsOf.app_setting");
  const out: ModuleSettings = {};
  for (const r of data as { key: string; value: unknown }[]) out[r.key as keyof ModuleSettings] = parseSetting(r.value);
  return out;
}

const s = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const f = (x: Decimal | null | undefined, dp: number) => (x === null || x === undefined ? null : toFixedString(x, dp));

export interface PoLine extends OrderLine {
  id: string;
  po_ref: string | null;
  po_date: string | null;
  sales_rep: string | null;
  item_code: string | null;
  customer: string | null;
  /** R48: a line synthesized from a locked commitment (id is not a sales_line id); it carries its own size. */
  synthetic: boolean;
  size_kg: string | null;
}

export interface PlanningSources {
  week: WeekRow;
  orders: PoLine[];
  forecasts: (ForecastLine & { id: string; customer: string | null })[];
  weights: { tentative: string; forecast: string };
  threshold: string;
  leadTimeDays: number;
  v1: { shrink: string; freight: string; maklon: string; lbPriceToday: string; yields: { karkas: string; kepala: string; ceker: string; usus: string; hja: string; lemak: string } };
  keys: Map<string, { segment: string; sku: string; form: string; cut_component: string | null; fresh_window_hours: number | null; frozen_age_limit_days: number | null; product_class: "main" | "by_product"; replacement_buy_price: string | null }>;
  prices: Map<string, string | null>;
  weightClasses: { code: string; avg_kg: string; min_kg: string | null; max_kg: string | null; sort_order: number }[];
  yieldRows: { weight_class: string; cut_pattern: string; key: string; yield_pct: string; note: string | null }[];
  /** K2: Aktual sales of the 8 weeks before the week (key, date, kg) and the days a key had no free stock. */
  history: { from: string; to: string; sales: { date: string; key: string; kg: string }[]; stockout: Set<string> };
  /**
   * Written reasons that let a PERIKSA control open the next step (§6.4). A C58 reason is bound to the plan version it was written
   * for by `plan_week_id` (B5, 5.2.3; R51); one without it (written before v5.2, or with no plan saved yet) is judged by `created_at`.
   */
  reasons: { code: string; reason: string; created_at?: string | null; plan_week_id?: string | null }[];
  substitutions: Substitution[];
  stock: { date: string | null; lots: { key: string; form: "fresh" | "frozen"; free_kg: string; age_days: number }[] };
  windows: { fresh: number; frozen: number };
  capacity: Map<string, { cut_capacity_head: number | null; chiller_kg: string | null; abf_kg: string | null }>;
  lbSupply: Row[];
  plans: Row[];
  planDays: Row[];
}

/** Everything one week's demand and plan need. */
export async function loadPlanning(sb: Supa, week: WeekRow): Promise<PlanningSources> {
  const ws = week.week_start, we = addDays(ws, 6);
  const hFrom = addDays(ws, -56), hTo = addDays(ws, -1);
  const [items, orders, forecasts, param, keys, prices, classes, yields, subs, cap, lb, plans, hist, outs, reasons] = await Promise.all([
    fetchAll<Row>((a, b) => sb.from("item_map").select("item_code, key").is("deleted_at", null).order("item_code").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("sales_line").select("id, date, delivery_date, demand_status, item_code, key_manual, kg, fulfilled_kg, cancelled_kg, price, customer, po_ref, po_date, sales_rep")
      .eq("status", "Order").is("deleted_at", null).is("superseded_at", null).or(`and(delivery_date.gte.${ws},delivery_date.lte.${we}),and(delivery_date.is.null,date.gte.${ws},date.lte.${we})`).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("forecast_line").select("id, week_start, key, kg, price_expected, sales_rep, customer, forecast_source").eq("week_start", ws).is("deleted_at", null).order("id").range(a, b)),
    sb.from("parameter").select("*").eq("week_id", week.id).maybeSingle(),
    fetchAll<Row>((a, b) => sb.from("sku_key").select("key, segment, sku, form, cut_component, fresh_window_hours, frozen_age_limit_days, product_class").order("key").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("sku_price").select("key, ref_sell_price, replacement_buy_price").eq("week_id", week.id).order("key").order("week_id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("weight_class").select("code, avg_kg, min_kg, max_kg, sort_order").order("sort_order").order("code").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("yield_matrix").select("weight_class, cut_pattern, key, yield_pct, effective_from, effective_to, note").is("deleted_at", null)
      .lte("effective_from", ws).order("effective_from").order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("substitution").select("key_demand, key_substitute, priority, max_pct").is("deleted_at", null).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("capacity").select("date, cut_capacity_head, chiller_kg, abf_kg").gte("date", ws).lte("date", we).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("lb_supply").select("*").gte("date", ws).lte("date", we).is("deleted_at", null).order("date").order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("plan_week").select("*").eq("week_start", ws).is("deleted_at", null).order("version", { ascending: false }).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("sales_line").select("date, item_code, key_manual, kg").eq("status", "Aktual").is("deleted_at", null).is("superseded_at", null).gte("date", hFrom).lte("date", hTo).order("id").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("sku_balance_daily").select("date, key").gte("date", hFrom).lte("date", hTo).lte("free_kg", 0).order("date").order("key").range(a, b)),
    fetchAll<Row>((a, b) => sb.from("plan_check_reason").select("code, reason, created_at, plan_week_id").eq("week_start", ws).is("deleted_at", null).order("id").range(a, b)),
  ]);
  // the replacement buy price is per week (sku_price, I_Master G), not a column of sku_key
  const buy = new Map(prices.map((x) => [String(x.key), s(x.replacement_buy_price)]));
  const keyOf = keyResolver(items.map((i) => ({ item_code: s(i.item_code), key: String(i.key) })));
  const p = needParameter(must(param, "planning.parameter"), "planning.parameter") as Row;
  const stockDate = addDays(ws, -1);
  const sd = must(await sb.from("lot_balance_daily").select("date").lte("date", stockDate).order("date", { ascending: false }).limit(1).maybeSingle(), "planning.lot_balance_daily");
  const sdate = sd ? String((sd as Row).date) : null;
  const lots = sdate ? await fetchAll<Row>((a, b) => sb.from("lot_balance_daily").select("key, form, free_kg, age_days").eq("date", sdate).gt("free_kg", 0).order("date").order("lot_ref").range(a, b)) : [];
  const latest = plans[0];
  const planDays = latest ? await fetchAll<Row>((a, b) => sb.from("plan_day").select("*").eq("plan_week_id", String(latest.id)).order("date").order("id").range(a, b)) : [];
  // the latest yield row per (class, pattern, key) effective on the week start
  const ym = new Map<string, Row>();
  for (const y of yields) if (!y.effective_to || String(y.effective_to) >= ws) ym.set(`${y.weight_class}|${y.cut_pattern}|${y.key}`, y);
  // a PO line without kg adds no demand: left out, not counted at 0
  const poLines: PoLine[] = orders.filter((o) => s(o.kg) !== null).map((o) => ({
    id: String(o.id), ref: String(o.id), key: keyOf(s(o.key_manual), s(o.item_code)), delivery_date: s(o.delivery_date) ?? s(o.date),
    demand_status: s(o.demand_status) ?? "Confirmed", kg: String(o.kg), fulfilled_kg: s(o.fulfilled_kg), cancelled_kg: s(o.cancelled_kg), price: s(o.price), customer: s(o.customer),
    po_ref: s(o.po_ref), po_date: s(o.po_date), sales_rep: s(o.sales_rep), item_code: s(o.item_code),
    synthetic: false, size_kg: null,
  }));
  // PRD v5 K26 (flag v5_commercial): the locked commitments of the week are Confirmed demand for the kg the POs do not cover
  const v5c = must(await sb.from("app_setting").select("value").eq("key", "v5_commercial").maybeSingle(), "planning.v5_commercial");
  if (((v5c as Row | null)?.value as { enabled?: boolean } | undefined)?.enabled === true) {
    // PRD v5.1 K41: a refused read is an error, not "no commitment"; K46: the engine keeps the highest locked version
    const commits = await fetchAll<Row>((a, b) => sb.from("sales_commitment").select("key, size_kg, fresh_kg, frozen_kg, price, status, version").eq("week_start", ws).eq("status", "locked").is("deleted_at", null).order("id").range(a, b));
    const extra = commitmentDemand({
      weekStart: ws, orders: poLines.filter((o) => o.demand_status === "Confirmed").map((o) => ({ key: o.key, kg: o.kg })),
      commitments: commits.map((c) => ({ key: String(c.key), size_kg: s(c.size_kg), fresh_kg: String(c.fresh_kg), frozen_kg: String(c.frozen_kg), price: s(c.price), status: "locked" as const, version: Number(c.version ?? 1) })),
    });
    poLines.push(...extra.map((e) => ({ ...e, id: e.ref, po_ref: null, po_date: null, sales_rep: null, item_code: null, customer: e.customer ?? null, synthetic: true, size_kg: s(e.size_kg) })));
  }
  return {
    week,
    orders: poLines,
    forecasts: forecasts.map((x) => ({ id: String(x.id), week_start: String(x.week_start), key: String(x.key), kg: String(x.kg), price_expected: s(x.price_expected), sales_rep: s(x.sales_rep), customer: s(x.customer), source: x.forecast_source === "stat" ? "stat" as const : "sales" as const })),
    weights: { tentative: s(p.tentative_weight) ?? "0.7", forecast: s(p.forecast_weight) ?? "0.5" },
    threshold: s(p.downgrade_approval_threshold) ?? "25000000",
    leadTimeDays: Number(p.lead_time_days ?? 1),
    v1: {
      shrink: String(p.target_shrink), freight: String(p.freight_plan_per_kg_lb), maklon: String(p.maklon_per_kg_processed), lbPriceToday: String(p.lb_price_today),
      yields: { karkas: String(p.yield_karkas), kepala: String(p.yield_kepala), ceker: String(p.yield_ceker), usus: String(p.yield_usus), hja: String(p.yield_hja), lemak: String(p.yield_lemak) },
    },
    keys: new Map(keys.map((k) => [String(k.key), {
      segment: String(k.segment), sku: String(k.sku), form: String(k.form), cut_component: s(k.cut_component),
      fresh_window_hours: k.fresh_window_hours === null ? null : Number(k.fresh_window_hours), frozen_age_limit_days: k.frozen_age_limit_days === null ? null : Number(k.frozen_age_limit_days),
      product_class: k.product_class === "by_product" ? "by_product" as const : "main" as const, replacement_buy_price: buy.get(String(k.key)) ?? null,
    }])),
    prices: new Map(prices.map((x) => [String(x.key), s(x.ref_sell_price)])),
    // PRD v5 §5.1: K / S / B exist before PPIC gives them an average; a class without one is not a v4 plan class yet
    weightClasses: classes.filter((c) => c.avg_kg !== null && c.avg_kg !== undefined).map((c) => ({ code: String(c.code), avg_kg: String(c.avg_kg), min_kg: s(c.min_kg), max_kg: s(c.max_kg), sort_order: Number(c.sort_order ?? 0) })), // missing-ok: urutan tampil kelas (indeks), bukan uang atau kg
    yieldRows: [...ym.values()].map((y) => ({ weight_class: String(y.weight_class), cut_pattern: String(y.cut_pattern), key: String(y.key), yield_pct: String(y.yield_pct), note: s(y.note) })),
    history: {
      from: hFrom, to: hTo,
      sales: hist.filter((h) => s(h.kg) !== null).map((h) => ({ date: String(h.date), key: keyOf(s(h.key_manual), s(h.item_code)), kg: String(h.kg) })),
      stockout: new Set(outs.map((o) => `${String(o.key)}|${String(o.date)}`)),
    },
    reasons: reasons.map((r) => ({ code: String(r.code), reason: String(r.reason), created_at: s(r.created_at), plan_week_id: s(r.plan_week_id) })),
    substitutions: subs.map((x) => ({ key_demand: String(x.key_demand), key_substitute: String(x.key_substitute), priority: Number(x.priority ?? 1), max_pct: String(x.max_pct ?? 1) })),
    // a lot without age cannot be judged against the window: it is not counted as eligible stock (never as a lot of age 0, i.e. fresh)
    stock: { date: sdate, lots: lots.filter((l) => l.age_days !== null && l.age_days !== undefined).map((l) => ({ key: String(l.key), form: l.form === "fresh" ? "fresh" : "frozen", free_kg: String(l.free_kg), age_days: Number(l.age_days) })) },
    windows: { fresh: Number(p.fresh_window_hours_default ?? 48), frozen: Number(p.frozen_age_limit_days_default ?? 30) },
    capacity: new Map(cap.map((c) => [String(c.date), { cut_capacity_head: c.cut_capacity_head === null ? null : Number(c.cut_capacity_head), chiller_kg: s(c.chiller_kg), abf_kg: s(c.abf_kg) }])),
    lbSupply: lb,
    plans,
    planDays,
  };
}

/** Production unit of a key: the SKU name of an RPA key (fresh and frozen are cut the same way); trading keys are bought. */
export function unitOf(src: PlanningSources, key: string): string | null {
  const k = src.keys.get(key);
  return k && k.segment === "RPA" ? k.sku : null;
}

/** Yields of a weight class keyed by production unit. yield_matrix.key may be the unit, an RPA key, or a cut component. */
export function unitYields(src: PlanningSources, weightClass: string): PatternYield[] {
  const rows = src.yieldRows.filter((y) => y.weight_class === weightClass);
  const units = new Map<string, { key: string; component: string | null }[]>();
  for (const [key, k] of src.keys) if (k.segment === "RPA") units.set(k.sku, [...(units.get(k.sku) ?? []), { key, component: k.cut_component }]);
  const out: PatternYield[] = [];
  const patterns = [...new Set(rows.map((r) => r.cut_pattern))];
  for (const [unit, ks] of units) {
    for (const p of patterns) {
      const inP = rows.filter((r) => r.cut_pattern === p);
      const hit = inP.find((r) => r.key === unit) ?? inP.find((r) => ks.some((k) => k.key === r.key))
        ?? inP.find((r) => ks.some((k) => k.component !== null && k.component === r.key) && !units.has(r.key));
      if (hit) out.push({ pattern: p, key: unit, yield_pct: hit.yield_pct });
    }
  }
  return out;
}

/** K1: a production unit decides heads when one of its RPA keys is a main product (sku_key.product_class). */
export function isMainUnit(src: PlanningSources, unit: string): boolean {
  let any = false;
  for (const k of src.keys.values()) if (k.segment === "RPA" && k.sku === unit) { any = true; if (k.product_class === "main") return true; }
  return !any;
}

/** Replacement buy price of a unit (any RPA key of it), for the C41 suggestion "beli trading". */
export function unitBuyPrice(src: PlanningSources, unit: string): string | null {
  for (const k of src.keys.values()) if (k.segment === "RPA" && k.sku === unit && k.replacement_buy_price !== null) return k.replacement_buy_price;
  return null;
}

/** K2: the statistical forecast of the week from the Aktual history (stockout days out), beyond the open PO kg. */
export function statForecast(src: PlanningSources) {
  const poKg = new Map<string, Decimal>();
  const ws = src.week.week_start, we = addDays(ws, 6);
  for (const o of src.orders) if (o.delivery_date && o.delivery_date >= ws && o.delivery_date <= we) poKg.set(o.key, (poKg.get(o.key) ?? D(0)).plus(outstandingKg(o)));
  return statForecastWeek({
    sales: src.history.sales, from: src.history.from, to: src.history.to, isWorkingDay: (d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0,
    stockout: (k, d) => src.history.stockout.has(`${k}|${d}`), weekStart: ws, poKg,
  });
}

export function patternOrder(src: PlanningSources): string[] {
  return [...new Set(src.yieldRows.map((y) => y.cut_pattern))].sort((a, b) => (a === "karkas" ? -1 : b === "karkas" ? 1 : a.localeCompare(b)));
}

export function defaultClass(src: PlanningSources, code?: string | null): PlanningSources["weightClasses"][number] | null {
  return src.weightClasses.find((c) => c.code === code) ?? src.weightClasses[0] ?? null;
}

export function computeDemand(src: PlanningSources, classCode?: string | null): { demand: WeekDemandResult; cls: PlanningSources["weightClasses"][number] | null; yields: PatternYield[] } {
  const cls = defaultClass(src, classCode);
  const yields = cls ? unitYields(src, cls.code) : [];
  const karkas = yields.find((y) => y.pattern === "karkas" && y.key === "Karkas")?.yield_pct ?? null;
  const stat = statForecast(src);
  const demand = weekDemand({
    weekStart: src.week.week_start, orders: src.orders, forecasts: [...src.forecasts, ...stat.lines], weights: src.weights,
    // P3.3: eligibility on the delivery date (first delivery of the week), counted from the stock date
    freeLots: src.stock.lots, daysAhead: daysAheadOf(src.stock.date ?? addDays(src.week.week_start, -1), firstDelivery(src.orders, src.week.week_start), src.leadTimeDays),
    windows: { freshHours: (k) => src.keys.get(k)?.fresh_window_hours ?? src.windows.fresh, frozenDays: (k) => src.keys.get(k)?.frozen_age_limit_days ?? src.windows.frozen },
    substitutions: src.substitutions, unitOf: (k) => unitOf(src, k), yields, avgLbKg: cls?.avg_kg ?? "2", patternOrder: patternOrder(src), karkasYield: karkas,
    isMain: (u) => isMainUnit(src, u),
  });
  return { demand, cls, yields };
}

/** Fresh / frozen reference prices per production unit (sku_price of the week): the downgrade per kg of surplus. */
export function unitPrices(src: PlanningSources): Record<string, { fresh: string | null; frozen: string | null }> {
  const out: Record<string, { fresh: string | null; frozen: string | null }> = {};
  for (const [key, k] of src.keys) {
    if (k.segment !== "RPA") continue;
    const o = out[k.sku] ?? { fresh: null, frozen: null };
    if (k.form === "Fresh") o.fresh = src.prices.get(key) ?? o.fresh;
    if (k.form === "Frozen") o.frozen = src.prices.get(key) ?? o.frozen;
    out[k.sku] = o;
  }
  return out;
}

export interface PlanProposal {
  demand: WeekDemandResult;
  yields: PatternYield[];
  proposal: WeekPlanProposal;
  days: { rows: DailyPlanRow[]; unplaced: number };
  cls: PlanningSources["weightClasses"][number] | null;
  /** Confirmed supply (ekor) from the rows that fill head_count; null = no row does (unknown, never 0). */
  supplyHeads: number | null;
  capacityHeads: number | null;
}

/** Steps 4–5 for the week: plan_week from the demand, split into plan_day by delivery − lead time. */
export function proposePlan(src: PlanningSources, opts: { classCode?: string | null; supplyCommittedHeads?: number | null } = {}): PlanProposal {
  const { demand, cls, yields } = computeDemand(src, opts.classCode);
  const confirmed = src.lbSupply.filter((r) => r.status === "confirmed" || r.status === "received");
  // ekor pasokan yang dikonfirmasi: hanya baris yang mengisi head_count berkomitmen; tanpa satu pun = tidak diketahui (bukan 0 ekor)
  const withHeads = confirmed.filter((r) => r.head_count !== null && r.head_count !== undefined);
  const supplyHeads = opts.supplyCommittedHeads ?? (withHeads.length ? withHeads.reduce((a, r) => a + Number(r.head_count), 0) : null);
  const days = Array.from({ length: 7 }, (_, i) => addDays(src.week.week_start, i));
  const caps = days.map((d) => src.capacity.get(d)?.cut_capacity_head ?? null);
  const capacityHeads = caps.every((c) => c === null) ? null : caps.reduce<number>((a, c) => a + (c ?? 0), 0); // missing-ok: jumlah kapasitas hari yang terisi; hari tanpa kapasitas ditandai C47 (BELUM DIISI)
  const proposal = proposeWeekPlan({
    heads: demand.heads, unitNet: demand.unitNet, yields, avgLbKg: cls?.avg_kg ?? "2", prices: unitPrices(src),
    supplyCommittedHeads: supplyHeads ?? undefined, capacityHeads, threshold: src.threshold, patternOrder: patternOrder(src),
  });
  const byDay = demandByDay({ orders: src.orders, forecasts: src.forecasts, weights: src.weights, weekStart: src.week.week_start, isCut: (k) => unitOf(src, k) !== null });
  const needs = splitHeadsByDay({ weekHeads: proposal.plan.head_count, weekStart: src.week.week_start, ...byDay });
  const lbByDay = new Map<string, number>();
  // a day's supply is known only from rows that fill head_count: without one the day has no figure (null below), never 0 ekor
  for (const r of withHeads) lbByDay.set(String(r.date), (lbByDay.get(String(r.date)) ?? 0) + Number(r.head_count)); // missing-ok: penghitung ekor per tanggal (akumulator), hanya dari baris yang berisi
  const planDays = dailyPlan({
    weekHeads: proposal.plan.head_count, needs, leadTimeDays: src.leadTimeDays, weekStart: src.week.week_start,
    limits: days.map((d) => ({ date: d, cut_capacity_head: src.capacity.get(d)?.cut_capacity_head ?? null, lb_supply_heads: lbByDay.has(d) ? lbByDay.get(d)! : null })),
  });
  return { demand, yields, proposal, days: planDays, cls, supplyHeads, capacityHeads };
}

export function demandRows(week: string, d: WeekDemandResult, cls: string | null, stockDate: string | null): Row[] {
  return d.rows.map((r) => ({
    week_start: week, key: r.key, confirmed_kg: f(r.confirmed_kg, 2), tentative_kg: f(r.tentative_kg, 2), forecast_kg: f(r.forecast_kg, 2), weighted_kg: f(r.weighted_kg, 2),
    stock_free_kg: f(r.stock_free_kg, 2), substituted_kg: f(r.substituted_kg, 2), net_kg: f(r.net_kg, 2), karkas_kg_equiv: f(r.karkas_kg_equiv, 2),
    cut_pattern: r.cut_pattern, kg_per_head: f(r.kg_per_head, 4), heads: f(r.heads, 4), binding: r.binding, weight_class: cls, stock_date: stockDate,
    unit: r.unit, product_class: r.product_class, source_forecast: r.source_forecast,
  }));
}

// ------------------------------------------------------------------------------------------------ rebuild (data mart)

let built = new Set<string>();

/** rebuildDay for M3: the weighted demand of the week containing the date (scope = its Monday). */
export async function buildDemandDay(sb: Supa, date: string): Promise<string> {
  const ws = mondayOf(date);
  if (built.has(ws)) return `minggu ${ws} sudah dibangun`;
  built.add(ws);
  const weeks = await listWeeks(sb);
  const week = weeks.find((w) => w.week_start === ws);
  if (!week) return `minggu ${ws} belum ada`;
  const src = await loadPlanning(sb, week);
  const latest = src.plans[0];
  const { demand, cls } = computeDemand(src, latest ? s(latest.weight_class) : null);
  const w = await martReplace(sb, "demand_weekly", ws, demandRows(ws, demand, cls?.code ?? null, src.stock.date));
  // K1 / C41: by-products short at the planned heads
  const sf = await martReplace(sb, "demand_shortfall", ws, shortfallRows(ws, demand, (u) => unitBuyPrice(src, u)).map((r) => ({
    week_start: r.week_start, key: r.key, net_kg: f(r.net_kg, 2), output_kg_at_plan: f(r.output_kg_at_plan, 2), shortfall_kg: f(r.shortfall_kg, 2), suggested_action: r.suggested_action,
  })));
  // P3.7: actual output per unit per day against the latest plan's targets, one scope per date of the week
  const v = await varianceRows(sb, src);
  let vw = 0;
  for (let i = 0; i < 7; i++) { const d = addDays(ws, i); vw += (await martReplace(sb, "plan_variance_daily", d, v.filter((r) => r.date === d))).written; }
  return `${demand.rows.length} key, ${demand.heads.heads} ekor, ${demand.shortfalls.filter((x) => x.shortfall_kg.gt(0)).length} by-product kurang (${w.written + sf.written + vw} ditulis, ${w.deleted + sf.deleted} dihapus)`;
}

/** plan_variance_daily rows of the week: Aktual batches (head count, SKU output mapped to production units) vs plan_day. */
export async function varianceRows(sb: Supa, src: PlanningSources): Promise<Row[]> {
  const ws = src.week.week_start, we = addDays(ws, 6);
  const batches = await fetchAll<Row>((a, b) => sb.from("batch").select("id, date, head_count").eq("status", "Aktual").is("deleted_at", null).gte("date", ws).lte("date", we).order("id").range(a, b));
  const outs = batches.length ? await inChunks(batches.map((x) => String(x.id)), (c) => fetchAll<Row>((a, b) => sb.from("batch_output_sku").select("batch_id, key, kg").in("batch_id", c).is("deleted_at", null).order("id").range(a, b))) : [];
  const dateOf = new Map(batches.map((b) => [String(b.id), String(b.date)]));
  const rows = planVarianceDaily({
    planDays: src.planDays.map((d) => ({ date: String(d.date), head_count: Number(d.head_count), target_kg_by_key: (d.target_kg_by_key ?? {}) as Record<string, string> })),
    actualOutput: outs.map((o) => ({ date: dateOf.get(String(o.batch_id)) ?? ws, unit: (o.key ? unitOf(src, String(o.key)) : null) ?? String(o.key ?? "tanpa key"), kg: String(o.kg) })),
    actualHeads: batches.filter((b) => b.head_count !== null).map((b) => ({ date: String(b.date), heads: Number(b.head_count) })),
    from: ws, to: we,
  });
  return rows.map((r) => ({ date: r.date, key: r.key, planned_kg: f(r.planned_kg, 2), actual_kg: f(r.actual_kg, 2), variance_kg: f(r.variance_kg, 2), planned_heads: r.planned_heads, actual_heads: r.actual_heads }));
}

/**
 * Controls of the PPIC page (PRD v4 §6.4, §7.1): C28 / C30 (v3) and C41, C42, C44, C46, C47 for the week's demand and
 * the proposed (or saved) plan. C45 is added by the caller (it reads the stock mart's status).
 */
export function ppicWeekControls(src: PlanningSources, p: PlanProposal, today: string): ControlV3[] {
  const stat = statForecast(src);
  const prices = unitPrices(src);
  const planDates = (src.planDays.length ? src.planDays.filter((d) => Number(d.head_count) > 0).map((d) => String(d.date)) : p.days.rows.filter((r) => r.head_count > 0).map((r) => r.date));
  const used = new Set(p.yields.map((y) => `${y.pattern}|${y.key}`));
  const notes = src.yieldRows.filter((y) => y.weight_class === (p.cls?.code ?? "") && [...used].some((u) => u.startsWith(`${y.cut_pattern}|`))).map((y) => y.note);
  const v4 = ppicControls({
    weekStart: src.week.week_start, demand: p.demand, buyPrice: (u) => unitBuyPrice(src, u), yieldNotes: notes,
    surplus: Object.entries(p.proposal.plan.surplus_kg_by_key).map(([key, kg]) => ({ key, kg: kg.toFixed(2), fresh: prices[key]?.fresh ?? null, frozen: prices[key]?.frozen ?? null })),
    planDates, capacity: (d) => src.capacity.get(d)?.cut_capacity_head ?? null,
    historyDays: stat.historyDays, forecastKeys: new Set([...src.forecasts.map((x) => x.key), ...stat.lines.map((x) => x.key)]),
  });
  return [...weekPlanningControls(src, today), ...v4];
}

export { ppicBlockers };

registerBuilder({ module: "m3_planning", name: "demand", begin: async () => { built = new Set(); }, build: buildDemandDay });

/** Reads for /w/[week]/demand: the data mart rows of the week. */
export async function demandWeekly(sb: Supa, weekStart: string): Promise<Row[]> {
  return fetchAll<Row>((a, b) => sb.from("demand_weekly").select("*").eq("week_start", weekStart).order("key").order("week_start").range(a, b));
}

// ------------------------------------------------------------------------------------------------ plan writes (PPIC)

export async function savePlan(sb: Supa, viewer: Viewer, week: WeekRow, opts: { classCode?: string | null; supplyCommittedHeads?: number | null; note?: string | null }): Promise<{ id: string; msg: string }> {
  // C45 (PRD v4 §3.1 P3.3): a plan is not saved on a stock mart older than its inputs (stock date = the Sunday before)
  const c45 = await stockMartControl(sb, addDays(week.week_start, -1));
  if (c45.status === "STALE") throw new WriteError(`C45 STALE: ${c45.action}`);
  const src = await loadPlanning(sb, week);
  const p = proposePlan(src, opts);
  const version = (src.plans.length ? Math.max(...src.plans.map((x) => Number(x.version))) : 0) + 1;
  const wp = p.proposal.plan;
  // C42: a plan on placeholder yields may be saved, labelled "yield sementara"; it cannot be copied to batches
  const ctl = [...ppicWeekControls(src, p, week.update_date), c45];
  const provisional = ctl.find((c) => c.code === "C42")?.status !== "LULUS";
  const { data, error } = await sb.from("plan_week").insert({
    week_start: week.week_start, version, weight_class: p.cls?.code ?? null, head_count: wp.head_count, heads_needed: wp.headsNeeded,
    supply_committed_heads: p.supplyHeads, capacity_heads: p.capacityHeads, binding_key: p.demand.binding.join(", ") || null,
    weight_class_mix: p.cls ? { [p.cls.code]: wp.head_count } : {}, cut_pattern_mix: p.proposal.patternMix,
    output_kg_by_key: Object.fromEntries(Object.entries(wp.output_kg_by_key).map(([k, v]) => [k, f(v, 2)])),
    surplus_kg_by_key: Object.fromEntries(Object.entries(wp.surplus_kg_by_key).filter(([, v]) => v.gt(0)).map(([k, v]) => [k, f(v, 2)])),
    frozen_planned_kg: f(wp.frozen_planned_kg, 2), frozen_planned_rp_downgrade: f(wp.rp_downgrade, 2), needs_approval: wp.needsApproval, note: opts.note ?? null,
    yield_provisional: provisional, controls: Object.fromEntries(ctl.map((c) => [c.code, c.status])),
  }).select("id").single();
  if (error) throw new WriteError(`plan_week: ${error.message}`);
  const id = String((data as Row).id);
  const mainPattern = Object.entries(p.proposal.patternMix).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const rows = p.days.rows.map((r) => ({
    plan_week_id: id, date: r.date, head_count: r.head_count, weight_class: p.cls?.code ?? null, cut_pattern: mainPattern,
    supplier: src.lbSupply.find((x) => String(x.date) === r.date && (x.status === "confirmed" || x.status === "received"))?.supplier ?? null,
    target_kg_by_key: Object.fromEntries(p.proposal.parts.map((pt) => [pt.key, toFixedString(D(r.head_count).times(D(pt.kgPerHead)), 2)])),
    limited_by: r.limited_by, moved_from_later: r.moved_from_later,
  }));
  const e2 = await sb.from("plan_day").insert(rows);
  if (e2.error) throw new WriteError(`plan_day: ${e2.error.message}`);
  void viewer;
  return { id, msg: `Rencana v${version}${provisional ? " (yield sementara)" : ""}: ${wp.head_count} ekor${wp.cappedByCapacity ? ` (dibatasi kapasitas, kurang ${wp.shortHeads})` : ""}${p.days.unplaced ? `, ${p.days.unplaced} ekor tidak muat di hari mana pun` : ""}${wp.needsApproval ? " — downgrade di atas batas, perlu persetujuan" : ""}` };
}

export async function approvePlan(sb: Supa, viewer: Viewer, planId: string): Promise<string> {
  // C46: a plan with surplus but no fresh / frozen price cannot be approved (the downgrade is unknown)
  const pw = must(await sb.from("plan_week").select("week_start, surplus_kg_by_key").eq("id", planId).maybeSingle(), "planning.plan_week");
  const plan = pw as Row | null;
  if (!plan) throw new WriteError("Rencana tidak ditemukan");
  const week = (await listWeeks(sb)).find((w) => w.week_start === String(plan.week_start));
  if (week) {
    const prices = unitPrices(await loadPlanning(sb, week));
    const missing = Object.entries((plan.surplus_kg_by_key ?? {}) as Record<string, string>).filter(([k, kg]) => D(kg).gt(0) && (!prices[k]?.fresh || !prices[k]?.frozen)).map(([k]) => k);
    if (missing.length) throw new WriteError(`C46: harga fresh/frozen kosong untuk SKU bersurplus (${missing.join(", ")}); isi harga dulu`);
  }
  const { error, count } = await sb.from("plan_week").update({ approved_by: viewer.email, approved_at: new Date().toISOString() }, { count: "exact" }).eq("id", planId).is("approved_by", null);
  if (error) throw new WriteError(error.message);
  return count ? "Rencana disetujui" : "Rencana sudah disetujui sebelumnya";
}

// "Salin ke batch rencana" (copyGate + copyPlanToBatches) lives in lib/v5/copy-plan.ts (PRD v5.2 R51, R52): it reads the
// class demand and the costing flags, which import this file.

/** C28 (late Confirmed PO lines) and C30 (plan day over capacity) for the week; C29/C31 come with the allocation (F3b). */
export function weekPlanningControls(src: PlanningSources, today: string): ControlV3[] {
  const all = planningControls({
    today,
    orders: src.orders.map((o) => ({ ref: o.ref, key: o.key, delivery_date: o.delivery_date, demand_status: s(o.demand_status), kg: o.kg, fulfilled_kg: o.fulfilled_kg ?? null })),
    planDays: src.planDays.map((d) => ({ date: String(d.date), head_count: Number(d.head_count), capacity: src.capacity.get(String(d.date))?.cut_capacity_head ?? null })),
  });
  return all.filter((c) => c.code === "C28" || c.code === "C30");
}

// ------------------------------------------------------------------------------------------------ uploads (PRD v3 §5)

async function itemKeys(sb: Supa): Promise<(km: string | null, ic: string | null) => string> {
  const items = await fetchAll<Row>((a, b) => sb.from("item_map").select("item_code, key").is("deleted_at", null).order("item_code").range(a, b));
  return keyResolver(items.map((i) => ({ item_code: s(i.item_code), key: String(i.key) })));
}

registerV3Kind({
  kind: "po_lines", module: "m3_planning", label: "Sales — PO lines (tgl kirim, status demand, sales)", source: "Manual",
  target: "sales_line", roles: ["admin", "sales", "commercial_lead"],
  description: "Kolom: tgl_po, no_po, customer, kode_item, kg, harga, tgl_kirim, status_demand (Confirmed/Tentative/Forecast), sales_rep. Menulis baris Order per minggu tanggal kirim; upload ulang PO yang sama menimpa baris PO itu saja.",
  async stage({ sb, sheets }) {
    const res = parseV3Table("po_lines", sheets);
    const weeks = await listWeeks(sb);
    const keyOf = await itemKeys(sb);
    const issues = [...res.issues];
    const ok: { target: string; data: Row }[] = [];
    const n = new Map<string, number>();
    for (const r of res.rows.filter((x) => !x.issues.length)) {
      const v = r.values;
      const st = normDemandStatus(v.demand_status);
      if (!st) { issues.push(`Baris ${r.rowNo}: status demand "${v.demand_status}" tidak dikenal`); continue; }
      const w = weekOfDate(weeks, v.delivery_date);
      if (!w) { issues.push(`Baris ${r.rowNo}: minggu tanggal kirim ${v.delivery_date} belum ada`); continue; }
      if (w.status === "closed") { issues.push(`Baris ${r.rowNo}: minggu ${w.week_start} sudah ditutup`); continue; }
      const base = `${v.po_ref}|${v.item_code ?? v.key_manual ?? ""}`;
      const i = (n.get(base) ?? 0) + 1; // missing-ok: penghitung baris untuk kunci baris (indeks)
      n.set(base, i);
      ok.push({ target: "po", data: { ...v, demand_status: st, week_id: w.id, week_start: w.week_start, key: keyOf(v.key_manual, v.item_code), line_key: `${base}|${i}` } });
    }
    const pos = [...new Set(ok.map((r) => String(r.data.po_ref)))];
    const existing = pos.length ? await inChunks(pos, (c) => fetchAll<Row>((a, b) => sb.from("sales_line").select("id, line_key, po_ref").eq("status", "Order").in("po_ref", c).is("deleted_at", null).order("id").range(a, b))) : [];
    const have = new Set(existing.map((e) => String(e.line_key)));
    const p = plan0("sales_line", "PO lines (Order)", [`${pos.length} PO`]);
    p.inserts = ok.filter((r) => !have.has(String(r.data.line_key))).length;
    p.updates = ok.length - p.inserts;
    p.deletes = existing.filter((e) => !ok.some((r) => r.data.line_key === e.line_key)).length;
    const dates = ok.map((r) => String(r.data.delivery_date)).sort();
    const unmapped = [...new Set(ok.filter((r) => r.data.key === "KODE BARU" || r.data.key === "").map((r) => String(r.data.item_code ?? "")))].map((code) => ({ code, name: null, suggested: null }));
    return { rows: ok, plan: [p], issues, note: `${ok.length} baris PO`, dateFrom: dates[0] ?? null, dateTo: dates[dates.length - 1] ?? null, sample: ok.slice(0, 25).map((r) => r.data), unmappedItems: unmapped };
  },
  async commit({ sb, viewer, uploadId, rows }) {
    // M7 (flag m7_approval): PO lines under the price floor need an approved discount
    const settings = await moduleSettingsOf(sb);
    const { covered } = await floorGuard(sb, viewer, settings, rows.map((r) => ({ key: s(r.data.key), customer: s(r.data.customer), price: s(r.data.price), kg: s(r.data.kg), date: s(r.data.delivery_date) })));
    const pos = [...new Set(rows.map((r) => String(r.data.po_ref)))];
    const existing = pos.length ? await inChunks(pos, (c) => fetchAll<Row>((a, b) => sb.from("sales_line").select("id, line_key, po_ref, week_id").eq("status", "Order").in("po_ref", c).is("deleted_at", null).order("id").range(a, b))) : [];
    const byKey = new Map(existing.map((e) => [String(e.line_key), e]));
    let inserted = 0, updated = 0;
    const dates = new Set<string>();
    for (const r of rows) {
      const v = r.data;
      const rec = {
        week_id: v.week_id, date: v.delivery_date, status: "Order", document_ref: v.po_ref, customer: s(v.customer), item_code: s(v.item_code), key_manual: s(v.key_manual),
        kg: D(s(v.kg)).toFixed(2), price: v.price === null || v.price === undefined ? null : D(s(v.price)).toFixed(4), source: "Manual", line_key: v.line_key, upload_id: uploadId,
        delivery_date: v.delivery_date, demand_status: v.demand_status, sales_rep: s(v.sales_rep), po_ref: v.po_ref, po_date: s(v.po_date),
      };
      dates.add(String(v.delivery_date));
      const old = byKey.get(String(v.line_key));
      const e = old ? await sb.from("sales_line").update(rec).eq("id", String(old.id)) : await sb.from("sales_line").insert(rec);
      if (e.error) throw new WriteError(`sales_line ${v.line_key}: ${e.error.message}`);
      if (old) updated++; else inserted++;
    }
    const gone = existing.filter((e) => !rows.some((r) => r.data.line_key === e.line_key));
    if (gone.length) {
      const ids = gone.map((g) => String(g.id));
      for (let i = 0; i < ids.length; i += 200) {
        const e = await sb.from("sales_line").update({ deleted_at: new Date().toISOString() }).in("id", ids.slice(i, i + 200));
        if (e.error) throw new WriteError(`sales_line: ${e.error.message}`);
      }
    }
    await consumeApprovals(sb, covered, null);
    return { inserted, updated, deleted: gone.length, dates: [...dates], message: "PO lines disimpan (Order)" };
  },
});

registerV3Kind({
  kind: "forecast_sales", module: "m3_planning", label: "Sales — forecast per minggu (rencana jual)", source: "Manual",
  target: "forecast_line", roles: ["admin", "sales", "commercial_lead"],
  description: "Kolom: minggu (Senin), kode_item, sales_rep, kg, harga. Upload ulang minggu × sales yang sama menimpa forecast sales itu.",
  async stage({ sb, sheets }) {
    const res = parseV3Table("forecast_sales", sheets);
    const keyOf = await itemKeys(sb);
    const issues = [...res.issues];
    const ok: { target: string; data: Row }[] = [];
    for (const r of res.rows.filter((x) => !x.issues.length)) {
      const v = r.values;
      const key = keyOf(v.key_manual, v.item_code);
      if (key === "" || key === "KODE BARU") { issues.push(`Baris ${r.rowNo}: kode item ${v.item_code ?? "—"} belum dipetakan ke key`); continue; }
      ok.push({ target: "forecast", data: { ...v, week_start: mondayOf(String(v.week_start)), key } });
    }
    const n = new Map<string, number>();
    for (const r of ok) { const b = `${r.data.week_start}|${r.data.item_code ?? r.data.key}|${r.data.sales_rep ?? ""}|${r.data.customer ?? ""}`; const i = (n.get(b) ?? 0) + 1; n.set(b, i); r.data.line_key = `${b}|${i}`; } // missing-ok: penghitung baris untuk kunci baris (indeks)
    const p = plan0("forecast_line", "Forecast sales", [...new Set(ok.map((r) => `minggu ${r.data.week_start}`))]);
    p.inserts = ok.length;
    const ws = ok.map((r) => String(r.data.week_start)).sort();
    return { rows: ok, plan: [p], issues, note: `${ok.length} baris forecast`, dateFrom: ws[0] ?? null, dateTo: ws[ws.length - 1] ?? null, sample: ok.slice(0, 25).map((r) => r.data), unmappedItems: [] };
  },
  async commit({ sb, uploadId, rows }) {
    const scopes = [...new Set(rows.map((r) => `${r.data.week_start}|${r.data.sales_rep ?? ""}`))];
    let deleted = 0;
    for (const sc of scopes) {
      const [ws, rep] = sc.split("|");
      let q = sb.from("forecast_line").update({ deleted_at: new Date().toISOString() }, { count: "exact" }).eq("week_start", ws).is("deleted_at", null);
      q = rep ? q.eq("sales_rep", rep) : q.is("sales_rep", null);
      const e = await q;
      if (e.error) throw new WriteError(`forecast_line: ${e.error.message}`);
      deleted += e.count ?? 0; // missing-ok: jumlah baris yang dihapus (hitungan)
    }
    const data = rows.map((r) => ({
      week_start: r.data.week_start, key: r.data.key, item_code: s(r.data.item_code), sales_rep: s(r.data.sales_rep), customer: s(r.data.customer), kg: D(s(r.data.kg)).toFixed(2),
      price_expected: r.data.price_expected === null || r.data.price_expected === undefined ? null : D(s(r.data.price_expected)).toFixed(4), basis: s(r.data.basis),
      line_key: r.data.line_key, upload_id: uploadId,
    }));
    if (data.length) { const e = await sb.from("forecast_line").insert(data); if (e.error) throw new WriteError(`forecast_line: ${e.error.message}`); }
    return { inserted: data.length, updated: 0, deleted, dates: [...new Set(data.map((d) => String(d.week_start)))], message: "Forecast sales disimpan" };
  },
});

registerV3Kind({
  kind: "yield_matrix", module: "m3_planning", label: "PPIC — yield matrix (kelas berat × pola potong × SKU)", source: "Manual",
  target: "yield_matrix", roles: ["admin", "ppic"],
  description: "Kolom: kelas berat, pola potong, SKU (nama SKU / key / komponen), yield (% atau pecahan dari kg LB), berlaku mulai. Baris yang sama (kelas × pola × SKU × mulai) ditimpa.",
  async stage({ sb, sheets }) {
    const res = parseV3Table("yield_matrix", sheets);
    const classes = new Set(mustRows(await sb.from("weight_class").select("code"), "planning.weight_class").map((c: Row) => String(c.code)));
    const issues = [...res.issues];
    const ok: { target: string; data: Row }[] = [];
    for (const r of res.rows.filter((x) => !x.issues.length)) {
      const y = yieldFraction(r.values.yield_pct);
      if (y === null) { issues.push(`Baris ${r.rowNo}: yield tidak valid`); continue; }
      if (!classes.has(String(r.values.weight_class))) { issues.push(`Baris ${r.rowNo}: kelas berat ${r.values.weight_class} belum ada di master`); continue; }
      ok.push({ target: "yield", data: { ...r.values, yield_pct: y, effective_from: r.values.effective_from ?? "2026-01-01" } });
    }
    const p = plan0("yield_matrix", "Yield matrix");
    p.inserts = ok.length;
    return { rows: ok, plan: [p], issues, note: `${ok.length} baris yield`, sample: ok.slice(0, 25).map((r) => r.data), unmappedItems: [] };
  },
  async commit({ sb, uploadId, rows }) {
    const data = rows.map((r) => ({ weight_class: r.data.weight_class, cut_pattern: String(r.data.cut_pattern).trim().toLowerCase(), key: String(r.data.key).trim(), yield_pct: r.data.yield_pct,
      effective_from: r.data.effective_from, effective_to: s(r.data.effective_to), upload_id: uploadId, deleted_at: null, note: null }));
    const e = await sb.from("yield_matrix").upsert(data, { onConflict: "weight_class,cut_pattern,key,effective_from" });
    if (e.error) throw new WriteError(`yield_matrix: ${e.error.message}`);
    return { inserted: data.length, updated: 0, deleted: 0, dates: [], message: "Yield matrix disimpan — bangun ulang demand minggu berjalan" };
  },
});

registerV3Kind({
  kind: "lb_supply", module: "m3_planning", label: "Purchasing — supply live bird (tawaran / konfirmasi)", source: "Manual",
  target: "lb_supply", roles: ["admin", "purchasing", "ppic"],
  description: "Kolom: tanggal, pemasok, kelas berat, ekor, kg, harga Rp/kg, status (offer/confirmed/received). Tanggal × pemasok × kelas yang sama ditimpa. Ekor confirmed membatasi rencana harian.",
  async stage({ sb, sheets }) {
    const res = parseV3Table("lb_supply", sheets);
    const issues = [...res.issues];
    const ok: { target: string; data: Row }[] = [];
    // PRD v5 C51 (flag v5_ppic_class): a supply row of a class that is not registered is not saved
    const flag = must(await sb.from("app_setting").select("value").eq("key", "v5_ppic_class").maybeSingle(), "planning.v5_ppic_class");
    const v5 = ((flag as Row | null)?.value as { enabled?: boolean } | undefined)?.enabled === true;
    const classes = v5 ? new Set(mustRows(await sb.from("weight_class").select("code"), "planning.weight_class").map((c: Row) => String(c.code))) : null;
    for (const r of res.rows.filter((x) => !x.issues.length)) {
      const st = normSupplyStatus(r.values.status);
      if (!st) { issues.push(`Baris ${r.rowNo}: status "${r.values.status}" tidak dikenal`); continue; }
      if (classes && r.values.weight_class && !classes.has(String(r.values.weight_class))) { issues.push(`Baris ${r.rowNo}: C51 GAGAL — kelas berat ${r.values.weight_class} belum terdaftar`); continue; }
      ok.push({ target: "lb", data: { ...r.values, status: st } });
    }
    const p = plan0("lb_supply", "Supply LB");
    p.inserts = ok.length;
    const ds = ok.map((r) => String(r.data.date)).sort();
    return { rows: ok, plan: [p], issues, note: `${ok.length} baris supply`, dateFrom: ds[0] ?? null, dateTo: ds[ds.length - 1] ?? null, sample: ok.slice(0, 25).map((r) => r.data), unmappedItems: [] };
  },
  async commit({ sb, uploadId, rows }) {
    const data = rows.map((r) => ({
      date: r.data.date, supplier: String(r.data.supplier).trim(), weight_class: s(r.data.weight_class), head_count: r.data.head_count === null ? null : Math.round(Number(r.data.head_count)),
      kg: r.data.kg === null || r.data.kg === undefined ? null : D(s(r.data.kg)).toFixed(2), price_per_kg: r.data.price_per_kg === null || r.data.price_per_kg === undefined ? null : D(s(r.data.price_per_kg)).toFixed(4),
      status: r.data.status, upload_id: uploadId, deleted_at: null,
    }));
    const e = await sb.from("lb_supply").upsert(data, { onConflict: "date,supplier,weight_class" });
    if (e.error) throw new WriteError(`lb_supply: ${e.error.message}`);
    return { inserted: data.length, updated: 0, deleted: 0, dates: [...new Set(data.map((d) => String(d.date)))], message: "Supply LB disimpan" };
  },
});
