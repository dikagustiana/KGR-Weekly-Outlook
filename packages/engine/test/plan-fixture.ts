/** M3 fixture of PRD v4 (§9.2 plan-2026-08-24): the example week's orders and opening stock through weekDemand. */
import { loadFixtureWeek, loadV3Fixture } from "../src/fixtures";
import { balanceAt, computeLedger, ledgerInputsFromWeek } from "../src/ledger";
import { weekDemand, type OrderLine, type PatternYield } from "../src/demand";
import { keyResolver } from "../src/index";
import { daysAheadOf, firstDelivery } from "../src/ppic-v4";

export interface PlanInputs {
  week_fixture: string; update_date: string; stock_balance_date: string;
  weight_class: { code: string; avg_kg: string; note: string };
  windows: { fresh_hours: number; frozen_days: number };
  weights: { tentative: string; forecast: string };
  pattern_order: string[];
  by_product_units: string[];
  yields: (PatternYield & { note: string })[];
}

export const planInp = loadV3Fixture<PlanInputs>("plan-2026-08-24", "inputs.json");
export const planGold = loadV3Fixture<Record<string, unknown> & {
  heads: number; binding: string; kg_lb: string; tolerance_kg: string; unit_net_kg: Record<string, string>; kg_per_head: Record<string, string>;
  by_product_output_kg: Record<string, string>; by_product_shortfall_kg: Record<string, string>; without_k1: { heads: number; binding: string; kg_lb: string; karkas_surplus_kg_approx: string };
}>("plan-2026-08-24", "golden.json");

export const planWeek = loadFixtureWeek(planInp.week_fixture.replace("week-", ""), planInp.update_date);
type Key = { key: string; segment: string; sku: string; form: string };
export const planKeys = planWeek.sku_keys as unknown as Key[];
export const unitOfKey = (k: string): string | null => { const s = planKeys.find((x) => x.key === k); return s && s.segment === "RPA" ? s.sku : null; };
const keyOf = keyResolver((planWeek.item_map as unknown as { item_code: string | null; key: string }[]).map((i) => ({ item_code: i.item_code, key: i.key })));

export function planOrders(): OrderLine[] {
  return (planWeek.sales_lines as unknown as Record<string, string | null>[]).filter((s) => s.status === "Order").map((o, i) => ({
    ref: String(o.row ?? i), key: keyOf(o.key_manual ?? null, o.item_code ?? null), delivery_date: o.delivery_date ?? o.date,
    demand_status: o.demand_status ?? "Confirmed", kg: String(o.kg), fulfilled_kg: o.fulfilled_kg ?? null, price: o.price ?? null, customer: o.customer ?? null,
  }));
}

export function planLots() {
  const li = ledgerInputsFromWeek(planWeek);
  const bal = balanceAt(computeLedger(li), planInp.stock_balance_date, li.keys, li.params);
  return bal.perLot.map((l) => ({ key: l.key, form: l.form === "fresh" ? ("fresh" as const) : ("frozen" as const), free_kg: l.free_kg.toFixed(2), age_days: l.age_days }));
}

/** weekDemand of the fixture week, with K1 (main products only) unless `k1` is false. */
export function planDemand(opts: { k1?: boolean } = {}) {
  const orders = planOrders();
  const by = new Set(planInp.by_product_units);
  const karkas = planInp.yields.find((y) => y.pattern === "karkas" && y.key === "Karkas")!.yield_pct;
  return weekDemand({
    weekStart: "2026-08-24", orders, forecasts: [], weights: planInp.weights, freeLots: planLots(),
    daysAhead: daysAheadOf("2026-08-23", firstDelivery(orders, "2026-08-24")),
    windows: { freshHours: () => planInp.windows.fresh_hours, frozenDays: () => planInp.windows.frozen_days },
    substitutions: [], unitOf: unitOfKey, yields: planInp.yields, avgLbKg: planInp.weight_class.avg_kg, patternOrder: planInp.pattern_order,
    karkasYield: karkas, isMain: opts.k1 === false ? undefined : (u) => !by.has(u),
  });
}
